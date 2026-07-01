import { config } from "./config.js";
import {
  confirmPeak,
  getPositionState,
  markInRange,
  markOutOfRange,
  minutesOutOfRange,
  setTrailingActive,
} from "./state.js";
import { getCandles } from "./ohlcv.js";
import { evaluateIndicatorSignals } from "./signals.js";
import { log } from "./logger.js";

/**
 * Evaluate one position and return an exit decision, or null to hold.
 * Priority order (first match wins — hard rules never overridden by soft ones):
 *   1. stop loss
 *   2. far above range (fully converted to base token, max exposure)
 *   3. trailing take-profit drop (only relevant once trailing has activated)
 *   4. static take-profit (fallback — mainly fires when trailing is disabled,
 *      or as a safety ceiling before trailing has a chance to activate)
 *   5. out-of-range timeout
 *   6. [soft] multi-indicator confluence (RSI/Bollinger/MACD/Supertrend agree
 *      bearish) while already in profit
 *   7. [soft] low yield (fee/value too low for too long)
 */
export async function evaluatePosition(position) {
  const { hardRules, softSignals, confirmTicks } = config;
  const posState = getPositionState(position.position);

  // Never act on a tick we couldn't reliably price (e.g. PnL API hiccup).
  if (position.pnl_pct_suspicious) {
    log("rules_skip", `${position.position.slice(0, 8)}: unpriceable tick, skipping`);
    return null;
  }

  const pnlPct = position.pnl_pct;

  // ── Track range state ────────────────────────────────────────────────
  if (position.in_range === false) markOutOfRange(position.position);
  else if (position.in_range === true) markInRange(position.position);

  // ── Track peak PnL (for trailing) ───────────────────────────────────
  if (pnlPct != null) {
    confirmPeak(position.position, pnlPct, confirmTicks);
  }

  // Activate trailing once the trigger threshold is confirmed-reached.
  if (
    hardRules.trailing.enabled &&
    !posState.trailing_active &&
    (posState.peak_pnl_pct ?? 0) >= hardRules.trailing.triggerPct
  ) {
    setTrailingActive(position.position, true);
    log("rules", `${position.position.slice(0, 8)}: trailing TP activated at peak ${posState.peak_pnl_pct.toFixed(2)}%`);
  }

  // ── 1. Stop loss ─────────────────────────────────────────────────────
  if (pnlPct != null && pnlPct <= hardRules.stopLossPct) {
    return { action: "CLOSE", reason: `stop loss (${pnlPct.toFixed(2)}% <= ${hardRules.stopLossPct}%)`, rule: "stop_loss" };
  }

  // ── 2. Far above range — position is now ~100% base token ──────────
  if (
    position.active_bin != null &&
    position.upper_bin != null &&
    position.active_bin > position.upper_bin + hardRules.farAboveRangeBins
  ) {
    return { action: "CLOSE", reason: "price pumped far above range — max exposure", rule: "far_above_range" };
  }

  // ── 3. Trailing take-profit drop ────────────────────────────────────
  if (hardRules.trailing.enabled && posState.trailing_active && pnlPct != null) {
    const dropFromPeak = (posState.peak_pnl_pct ?? 0) - pnlPct;
    if (dropFromPeak >= hardRules.trailing.dropPct) {
      return {
        action: "CLOSE",
        reason: `trailing TP: peak ${posState.peak_pnl_pct.toFixed(2)}% → now ${pnlPct.toFixed(2)}% (dropped ${dropFromPeak.toFixed(2)}%)`,
        rule: "trailing_take_profit",
      };
    }
  }

  // ── 4. Static take-profit (fallback / ceiling) ──────────────────────
  if (pnlPct != null && pnlPct >= hardRules.takeProfitPct && !posState.trailing_active) {
    return { action: "CLOSE", reason: `take profit (${pnlPct.toFixed(2)}% >= ${hardRules.takeProfitPct}%)`, rule: "take_profit" };
  }

  // ── 5. Out-of-range timeout ──────────────────────────────────────────
  if (position.in_range === false) {
    const oorMinutes = minutesOutOfRange(position.position);
    if (oorMinutes >= hardRules.outOfRangeWaitMinutes) {
      return { action: "CLOSE", reason: `out of range for ${oorMinutes}m (limit ${hardRules.outOfRangeWaitMinutes}m)`, rule: "out_of_range" };
    }
  }

  // ── Soft signals (only reached if no hard rule fired) ───────────────
  if (softSignals.enabled && pnlPct != null) {
    const indCfg = softSignals.indicators;
    if (indCfg.enabled && pnlPct >= indCfg.minPnlPctToAct) {
      const candles = await getCandles({
        poolAddress: position.pool,
        timeframe: indCfg.timeframe,
        limit: indCfg.candleLimit,
        cacheTtlSec: indCfg.cacheTtlSec,
      });

      if (candles && candles.length > 0) {
        const result = evaluateIndicatorSignals(candles, indCfg);
        if (result.agrees) {
          const agreeing = Object.entries(result.details)
            .filter(([, v]) => v.bearish)
            .map(([k]) => k)
            .join(", ");
          return {
            action: "CLOSE",
            reason: `${result.bearishVotes}/${result.totalVotes} indicators bearish (${agreeing}) while in profit (${pnlPct.toFixed(2)}%) — preventive exit`,
            rule: "indicator_confluence",
          };
        }
      } else {
        log("rules_skip", `${position.position.slice(0, 8)}: no candle data available, skipping indicator check`);
      }
    }

    if (softSignals.lowYield.enabled && position.age_minutes != null && position.total_value_usd > 0) {
      if (position.age_minutes >= softSignals.lowYield.minAgeMinutesBeforeCheck) {
        // fee earned so far, annualized to a rough 24h-equivalent %, as a proxy
        // for "is this still worth having capital parked here".
        const feePct = (position.unclaimed_fees_usd / position.total_value_usd) * 100;
        const hoursHeld = position.age_minutes / 60;
        const feePct24hEquiv = hoursHeld > 0 ? (feePct / hoursHeld) * 24 : 0;
        if (feePct24hEquiv < softSignals.lowYield.minFeePerValuePct24hEquiv) {
          return {
            action: "CLOSE",
            reason: `low yield (${feePct24hEquiv.toFixed(2)}%/24h equiv < ${softSignals.lowYield.minFeePerValuePct24hEquiv}%)`,
            rule: "low_yield",
          };
        }
      }
    }
  }

  return null;
}
