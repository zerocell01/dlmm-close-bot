import "dotenv/config";
import { config } from "./config.js";
import { discoverWalletPositions } from "./positions.js";
import { evaluatePosition } from "./rules.js";
import { closePosition } from "./executor.js";
import { registerExitSignal, pruneStaleState, touchPosition } from "./state.js";
import { notify } from "./notify.js";
import { log } from "./logger.js";
import { getWallet } from "./wallet.js";

let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const positions = await discoverWalletPositions();
    pruneStaleState(positions.map((p) => p.position));

    if (positions.length === 0) {
      log("tick", "No open positions found.");
      return;
    }

    for (const position of positions) {
      touchPosition(position.position);
      const decision = evaluatePosition(position);

      const { fire } = registerExitSignal(
        position.position,
        decision?.rule ?? null,
        config.confirmTicks,
      );

      const short = position.position.slice(0, 8);
      const pnlStr = position.pnl_pct != null ? `${position.pnl_pct.toFixed(2)}%` : "n/a";
      const rangeStr = position.in_range === false ? "OOR" : position.in_range === true ? "IN" : "?";

      if (decision && fire) {
        log(
          "decision",
          `${short}: CLOSE (${decision.rule}) — ${decision.reason} | pnl=${pnlStr} range=${rangeStr}`,
        );
        const result = await closePosition({
          positionAddress: position.position,
          poolAddress: position.pool,
          reason: decision.reason,
        });
        const prefix = config.execution.dryRun ? "🧪 DRY RUN" : result.success ? "✅ CLOSED" : "❌ CLOSE FAILED";
        await notify(
          `${prefix}\nPosition: \`${short}...\`\nReason: ${decision.reason}\nPnL: ${pnlStr}` +
            (result.txs?.length ? `\nTx: \`${result.txs[result.txs.length - 1]}\`` : ""),
        );
      } else if (decision) {
        log("decision", `${short}: signal ${decision.rule} pending confirmation — pnl=${pnlStr} range=${rangeStr}`);
      } else {
        log("hold", `${short}: hold — pnl=${pnlStr} range=${rangeStr}`);
      }
    }
  } catch (e) {
    log("tick_error", e.message);
  } finally {
    busy = false;
  }
}

async function main() {
  const wallet = getWallet();
  log("startup", `Wallet: ${wallet.publicKey.toString()}`);
  log("startup", `Dry run: ${config.execution.dryRun}`);
  log("startup", `Poll interval: ${config.pollIntervalSec}s | confirm ticks: ${config.confirmTicks}`);
  log(
    "startup",
    `Hard rules: SL ${config.hardRules.stopLossPct}% | TP ${config.hardRules.takeProfitPct}% | ` +
      `trailing ${config.hardRules.trailing.enabled ? `on (trigger ${config.hardRules.trailing.triggerPct}%, drop ${config.hardRules.trailing.dropPct}%)` : "off"} | ` +
      `OOR wait ${config.hardRules.outOfRangeWaitMinutes}m`,
  );

  if (config.execution.dryRun) {
    log("startup", "⚠️  DRY_RUN=true — no real transactions will be sent. Set DRY_RUN=false in .env when ready.");
  }

  await tick();
  setInterval(tick, config.pollIntervalSec * 1000);
}

main().catch((e) => {
  log("fatal", e.message);
  process.exit(1);
});
