import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");

const userConfig = fs.existsSync(CONFIG_PATH)
  ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
  : {};

export const config = {
  // ── Polling ──────────────────────────────────────────────────────────
  // How often to re-check every open position. This is pure RPC reads +
  // arithmetic — no LLM, no external inference. Safe to run frequently.
  pollIntervalSec: userConfig.pollIntervalSec ?? 5,

  // Consecutive confirming ticks required before a peak is raised or an
  // exit fires. Filters single-tick noise (e.g. a stale RPC read) without
  // adding real latency at a 5s poll cadence.
  confirmTicks: userConfig.confirmTicks ?? 2,

  // ── Hard rules (always win, never overridden by soft signals) ─────────
  hardRules: {
    // Close if PnL % drops to/below this. Negative number.
    stopLossPct: userConfig.hardRules?.stopLossPct ?? -15,

    // Close if PnL % reaches/exceeds this AND trailing is disabled.
    // If trailing is enabled, this becomes a fallback ceiling only.
    takeProfitPct: userConfig.hardRules?.takeProfitPct ?? 8,

    // Trailing take-profit — lets winners run, locks in gains on reversal.
    trailing: {
      enabled: userConfig.hardRules?.trailing?.enabled ?? true,
      // Start tracking peak once PnL reaches this %.
      triggerPct: userConfig.hardRules?.trailing?.triggerPct ?? 3,
      // Close once PnL drops this many % from the confirmed peak.
      dropPct: userConfig.hardRules?.trailing?.dropPct ?? 1.5,
    },

    // If price is above the position's upper bin by more than this many
    // bins, close immediately — position is fully converted to the base
    // token and exposure is maximal. This fires BEFORE the OOR wait timer.
    farAboveRangeBins: userConfig.hardRules?.farAboveRangeBins ?? 10,

    // Out-of-range handling: once price leaves the position's bin range,
    // wait this many minutes (price may re-enter) before closing due to
    // idle capital.
    outOfRangeWaitMinutes: userConfig.hardRules?.outOfRangeWaitMinutes ?? 30,
  },

  // ── Soft signals (only consulted when no hard rule has fired) ─────────
  softSignals: {
    enabled: userConfig.softSignals?.enabled ?? true,

    // Multi-indicator confluence, computed from REAL OHLCV candles fetched
    // from GeckoTerminal's free public API (no key needed). Each indicator
    // votes bearish/not-bearish independently; a close only fires once
    // `minSignalsAgree` of them agree AND PnL is already positive by at
    // least `minPnlPctToAct` — this is a preventive/soft exit, never a
    // reason to close a losing position on its own.
    indicators: {
      enabled: userConfig.softSignals?.indicators?.enabled ?? true,
      // Meteora OHLCV timeframe values: "5m" | "30m" | "1h" | "2h" | "4h" | "12h" | "24h"
      timeframe: userConfig.softSignals?.indicators?.timeframe ?? "5m",
      candleLimit: userConfig.softSignals?.indicators?.candleLimit ?? 100,
      cacheTtlSec: userConfig.softSignals?.indicators?.cacheTtlSec ?? 60,
      minPnlPctToAct: userConfig.softSignals?.indicators?.minPnlPctToAct ?? 1,
      minSignalsAgree: userConfig.softSignals?.indicators?.minSignalsAgree ?? 2,
      rsi: {
        enabled: userConfig.softSignals?.indicators?.rsi?.enabled ?? true,
        period: userConfig.softSignals?.indicators?.rsi?.period ?? 14,
        overbought: userConfig.softSignals?.indicators?.rsi?.overbought ?? 75,
      },
      bollinger: {
        enabled: userConfig.softSignals?.indicators?.bollinger?.enabled ?? true,
        period: userConfig.softSignals?.indicators?.bollinger?.period ?? 20,
        stdDevMult: userConfig.softSignals?.indicators?.bollinger?.stdDevMult ?? 2,
      },
      macd: {
        enabled: userConfig.softSignals?.indicators?.macd?.enabled ?? true,
        fastPeriod: userConfig.softSignals?.indicators?.macd?.fastPeriod ?? 12,
        slowPeriod: userConfig.softSignals?.indicators?.macd?.slowPeriod ?? 26,
        signalPeriod: userConfig.softSignals?.indicators?.macd?.signalPeriod ?? 9,
      },
      supertrend: {
        enabled: userConfig.softSignals?.indicators?.supertrend?.enabled ?? true,
        period: userConfig.softSignals?.indicators?.supertrend?.period ?? 10,
        multiplier: userConfig.softSignals?.indicators?.supertrend?.multiplier ?? 3,
      },
    },

    // Low yield: fee earned relative to position value is too low to
    // justify keeping capital parked here.
    lowYield: {
      enabled: userConfig.softSignals?.lowYield?.enabled ?? true,
      minFeePerValuePct24hEquiv: userConfig.softSignals?.lowYield?.minFeePerValuePct24hEquiv ?? 3,
      minAgeMinutesBeforeCheck: userConfig.softSignals?.lowYield?.minAgeMinutesBeforeCheck ?? 60,
    },
  },

  // ── Execution ────────────────────────────────────────────────────────
  execution: {
    dryRun: (process.env.DRY_RUN ?? "true") === "true",
    // Max positions to hold state for; purely a sanity cap.
    maxTrackedPositions: userConfig.execution?.maxTrackedPositions ?? 50,
  },

  // ── RPC ──────────────────────────────────────────────────────────────
  rpc: {
    txRpcUrl: process.env.RPC_URL,
    pollRpcUrl: process.env.POLL_RPC_URL || "https://pump.helius-rpc.com",
  },
};

export function loadUserConfigRaw() {
  return userConfig;
}
