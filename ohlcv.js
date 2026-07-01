import { log } from "./logger.js";

// ── Primary: Meteora's own OHLCV endpoint ────────────────────────────
// Same domain (dlmm.datapi.meteora.ag) the bot already calls for PnL data.
// Free, no API key, 30 requests/second rate limit. Since it's the source
// of truth for these exact pools, there's no indexing-lag risk for
// brand-new tokens the way there can be with a third-party aggregator.
const METEORA_OHLCV = "https://dlmm.datapi.meteora.ag/pools";

// Allowed Meteora timeframe values and their duration in seconds — used to
// compute a start_time window that yields roughly `limit` candles, since
// the endpoint takes a time range rather than a candle count.
const METEORA_TIMEFRAME_SECONDS = {
  "5m": 300,
  "30m": 1800,
  "1h": 3600,
  "2h": 7200,
  "4h": 14400,
  "12h": 43200,
  "24h": 86400,
};

// ── Fallback: GeckoTerminal's free public API ────────────────────────
// Only used if Meteora's endpoint is unreachable or returns nothing.
const GECKOTERMINAL_URL = "https://api.geckoterminal.com/api/v2";
const GECKOTERMINAL_NETWORK = "solana";

const _cache = new Map(); // `${poolAddress}:${timeframe}` -> { candles, fetchedAt }

async function fetchFromMeteora(poolAddress, timeframe, limit) {
  const secondsPerCandle = METEORA_TIMEFRAME_SECONDS[timeframe] ?? METEORA_TIMEFRAME_SECONDS["5m"];
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - secondsPerCandle * limit;

  const url = `${METEORA_OHLCV}/${poolAddress}/ohlcv?timeframe=${timeframe}&start_time=${startTime}&end_time=${endTime}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Meteora OHLCV ${res.status}`);
  const data = await res.json();
  const rows = data?.data;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  return rows
    .map((r) => ({ time: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }))
    .sort((a, b) => a.time - b.time);
}

// GeckoTerminal uses "minute"/"hour"/"day" + aggregate, not Meteora's "5m"/"1h" style.
function toGeckoTerminalParams(timeframe) {
  const map = {
    "5m": { timeframe: "minute", aggregate: 5 },
    "30m": { timeframe: "minute", aggregate: 15 }, // 15 is GT's max minute aggregate
    "1h": { timeframe: "hour", aggregate: 1 },
    "2h": { timeframe: "hour", aggregate: 1 },
    "4h": { timeframe: "hour", aggregate: 4 },
    "12h": { timeframe: "hour", aggregate: 12 },
    "24h": { timeframe: "day", aggregate: 1 },
  };
  return map[timeframe] ?? map["5m"];
}

async function fetchFromGeckoTerminal(poolAddress, timeframe, limit) {
  const { timeframe: gtTimeframe, aggregate } = toGeckoTerminalParams(timeframe);
  const url = `${GECKOTERMINAL_URL}/networks/${GECKOTERMINAL_NETWORK}/pools/${poolAddress}/ohlcv/${gtTimeframe}?aggregate=${aggregate}&limit=${limit}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
  const data = await res.json();
  const rows = data?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  return rows
    .map(([t, o, h, l, c, v]) => ({ time: t, open: o, high: h, low: l, close: c, volume: v }))
    .sort((a, b) => a.time - b.time);
}

/**
 * Fetch OHLCV candles for a DLMM pool, cached per pool+timeframe.
 * Tries Meteora's own endpoint first, falls back to GeckoTerminal if that
 * fails (e.g. transient outage). Returns null (never throws) if both fail
 * — callers must treat null as "skip this check", not as a bearish signal.
 *
 * timeframe: one of "5m" | "30m" | "1h" | "2h" | "4h" | "12h" | "24h"
 */
export async function getCandles({ poolAddress, timeframe = "5m", limit = 100, cacheTtlSec = 60 }) {
  const cacheKey = `${poolAddress}:${timeframe}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < cacheTtlSec * 1000) {
    return cached.candles;
  }

  let candles = null;
  try {
    candles = await fetchFromMeteora(poolAddress, timeframe, limit);
  } catch (e) {
    log("ohlcv_warn", `Meteora OHLCV failed for ${poolAddress.slice(0, 8)}: ${e.message} — trying fallback`);
  }

  if (!candles) {
    try {
      candles = await fetchFromGeckoTerminal(poolAddress, timeframe, limit);
    } catch (e) {
      log("ohlcv_warn", `GeckoTerminal fallback also failed for ${poolAddress.slice(0, 8)}: ${e.message}`);
    }
  }

  if (candles) {
    _cache.set(cacheKey, { candles, fetchedAt: Date.now() });
    return candles;
  }

  return cached?.candles || null; // stale cache is better than nothing
}
