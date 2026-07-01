import { PublicKey } from "@solana/web3.js";
import { getPollConnection, getWallet } from "./wallet.js";
import { log } from "./logger.js";

const DLMM_PROGRAM = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
const METEORA_PNL = "https://dlmm.datapi.meteora.ag/positions";

function safeNum(v) {
  const n = parseFloat(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function maybeNum(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchPnlForPool(poolAddress, walletAddress) {
  const url = `${METEORA_PNL}/${poolAddress}/pnl?user=${walletAddress}&status=open&pageSize=100&page=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const data = await res.json();
    const list = data.positions || data.data || [];
    const byAddress = {};
    for (const p of list) {
      const addr = p.positionAddress || p.address || p.position;
      if (addr) byAddress[addr] = p;
    }
    return byAddress;
  } catch (e) {
    log("pnl_api_error", `${poolAddress.slice(0, 8)}: ${e.message}`);
    return {};
  }
}

function deriveOpenPnlPct(p) {
  const deposits = safeNum(p?.allTimeDeposits?.total?.usd);
  const withdrawals = safeNum(p?.allTimeWithdrawals?.total?.usd);
  const currentValue = safeNum(p?.unrealizedPnl?.balances);
  const unclaimedFees =
    safeNum(p?.unrealizedPnl?.unclaimedFeeTokenX?.usd) +
    safeNum(p?.unrealizedPnl?.unclaimedFeeTokenY?.usd);
  if (deposits <= 0) return null;
  const totalValue = currentValue + unclaimedFees + withdrawals;
  return ((totalValue - deposits) / deposits) * 100;
}

/**
 * Discover every open DLMM position owned by the wallet — no manual
 * registration needed. This is what makes "open manual, close automated"
 * work: the bot finds whatever you deployed by hand.
 */
export async function discoverWalletPositions() {
  const wallet = getWallet();
  const walletAddress = wallet.publicKey.toString();
  const connection = getPollConnection();

  const accounts = await connection.getProgramAccounts(DLMM_PROGRAM, {
    filters: [{ memcmp: { offset: 40, bytes: wallet.publicKey.toBase58() } }],
  });

  if (accounts.length === 0) return [];

  const raw = accounts.map((acc) => ({
    position: acc.pubkey.toBase58(),
    pool: new PublicKey(acc.account.data.slice(8, 40)).toBase58(),
  }));

  const uniquePools = [...new Set(raw.map((r) => r.pool))];
  const pnlMaps = await Promise.all(uniquePools.map((pool) => fetchPnlForPool(pool, walletAddress)));
  const pnlByPool = {};
  uniquePools.forEach((pool, i) => { pnlByPool[pool] = pnlMaps[i]; });

  return raw.map((r) => {
    const p = pnlByPool[r.pool]?.[r.position] || null;
    const unclaimedFeesUsd = p
      ? safeNum(p.unrealizedPnl?.unclaimedFeeTokenX?.usd) + safeNum(p.unrealizedPnl?.unclaimedFeeTokenY?.usd)
      : 0;
    const currentValueUsd = p ? safeNum(p.unrealizedPnl?.balances) : 0;
    const reportedPnlPct = p ? maybeNum(p.pnlPctChange) : null;
    const derivedPnlPct = p ? deriveOpenPnlPct(p) : null;

    return {
      position: r.position,
      pool: r.pool,
      base_mint: p?.tokenX?.mint ?? null,
      quote_mint: p?.tokenY?.mint ?? null,
      lower_bin: p?.lowerBinId ?? null,
      upper_bin: p?.upperBinId ?? null,
      active_bin: p?.poolActiveBinId ?? null,
      in_range: p ? !p.isOutOfRange : null,
      unclaimed_fees_usd: Math.round(unclaimedFeesUsd * 10000) / 10000,
      total_value_usd: Math.round(currentValueUsd * 10000) / 10000,
      pnl_pct: reportedPnlPct ?? derivedPnlPct ?? null,
      pnl_pct_suspicious: p == null, // couldn't price this tick — never act on it
      age_minutes: p?.createdAt ? Math.floor((Date.now() - p.createdAt * 1000) / 60000) : null,
      deposits_usd: p ? safeNum(p.allTimeDeposits?.total?.usd) : null,
    };
  });
}
