import { PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { config } from "./config.js";
import { getTxConnection, getWallet } from "./wallet.js";
import { removePositionState } from "./state.js";
import { log } from "./logger.js";

let _DLMM = null;
async function loadDlmmSdk() {
  if (!_DLMM) {
    const mod = await import("@meteora-ag/dlmm");
    _DLMM = mod.default;
  }
  return _DLMM;
}

/**
 * Close a DLMM position: claim any outstanding fees, then remove 100% of
 * liquidity (SDK auto-closes the position account when shouldClaimAndClose
 * is set). Falls back to a plain closePosition call if there's no
 * liquidity left (e.g. already fully out-of-range / drained).
 */
export async function closePosition({ positionAddress, poolAddress, reason }) {
  if (config.execution.dryRun) {
    log("dry_run", `Would close ${positionAddress} (pool ${poolAddress}) — reason: ${reason}`);
    return { success: true, dryRun: true, position: positionAddress, reason };
  }

  const DLMM = await loadDlmmSdk();
  const connection = getTxConnection();
  const wallet = getWallet();

  log("close", `Closing ${positionAddress} — reason: ${reason}`);

  const pool = await DLMM.create(connection, new PublicKey(poolAddress));
  const positionPubKey = new PublicKey(positionAddress);

  const txHashes = [];

  // Step 1: claim outstanding fees first (clears account state cleanly).
  try {
    const positionData = await pool.getPosition(positionPubKey);
    const claimTxs = await pool.claimSwapFee({ owner: wallet.publicKey, position: positionData });
    for (const tx of claimTxs || []) {
      const hash = await sendAndConfirmTransaction(connection, tx, [wallet]);
      txHashes.push(hash);
    }
  } catch (e) {
    log("close_warn", `Claim step failed or nothing to claim: ${e.message}`);
  }

  // Step 2: remove liquidity (or close bare account if nothing's left).
  let hasLiquidity = false;
  let fromBinId = -887272;
  let toBinId = 887272;
  try {
    const positionData = await pool.getPosition(positionPubKey);
    const processed = positionData?.positionData;
    if (processed) {
      fromBinId = processed.lowerBinId ?? fromBinId;
      toBinId = processed.upperBinId ?? toBinId;
      hasLiquidity = (processed.positionBinData || []).some((b) => new BN(b.positionLiquidity || "0").gt(new BN(0)));
    }
  } catch (e) {
    log("close_warn", `Could not read liquidity state: ${e.message}`);
  }

  try {
    if (hasLiquidity) {
      const closeTx = await pool.removeLiquidity({
        user: wallet.publicKey,
        position: positionPubKey,
        fromBinId,
        toBinId,
        bps: new BN(10000), // 100%
        shouldClaimAndClose: true,
      });
      for (const tx of Array.isArray(closeTx) ? closeTx : [closeTx]) {
        const hash = await sendAndConfirmTransaction(connection, tx, [wallet]);
        txHashes.push(hash);
      }
    } else {
      const closeTx = await pool.closePosition({
        owner: wallet.publicKey,
        position: { publicKey: positionPubKey },
      });
      const hash = await sendAndConfirmTransaction(connection, closeTx, [wallet]);
      txHashes.push(hash);
    }
  } catch (e) {
    log("close_error", `Close transaction failed: ${e.message}`);
    return { success: false, error: e.message, position: positionAddress, txs: txHashes };
  }

  log("close", `SUCCESS ${positionAddress} — txs: ${txHashes.join(", ") || "none"}`);
  removePositionState(positionAddress);
  return { success: true, position: positionAddress, txs: txHashes, reason };
}
