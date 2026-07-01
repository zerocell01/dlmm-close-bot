/**
 * Pure indicator math on OHLCV candle arrays: [{ time, open, high, low, close, volume }, ...]
 * ascending by time. No external dependency — small and auditable.
 */

export function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let emaVal = values.slice(0, period).reduce((a, b) => a + b, 0) / period; // seed with SMA
  for (let i = period; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

/** Full EMA series (not just the last value) — needed for MACD. */
function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let emaVal = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = emaVal;
  for (let i = period; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
    out[i] = emaVal;
  }
  return out;
}

/** Classic Wilder RSI over closing prices. */
export function rsi(candles, period = 14) {
  const closes = candles.map((c) => c.close);
  if (closes.length < period + 1) return null;
  const slice = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Bollinger Bands: { middle, upper, lower } from SMA + stddev of closes. */
export function bollingerBands(candles, period = 20, stdDevMult = 2) {
  const closes = candles.map((c) => c.close);
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    middle: mean,
    upper: mean + stdDevMult * stdDev,
    lower: mean - stdDevMult * stdDev,
  };
}

/** MACD: { macd, signal, histogram } — standard 12/26/9 by default. */
export function macd(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const closes = candles.map((c) => c.close);
  if (closes.length < slowPeriod + signalPeriod) return null;

  const fastSeries = emaSeries(closes, fastPeriod);
  const slowSeries = emaSeries(closes, slowPeriod);

  const macdSeries = [];
  for (let i = 0; i < closes.length; i++) {
    if (fastSeries[i] != null && slowSeries[i] != null) {
      macdSeries[i] = fastSeries[i] - slowSeries[i];
    }
  }
  const macdValues = macdSeries.filter((v) => v != null);
  if (macdValues.length < signalPeriod) return null;

  const signalSeries = emaSeries(macdValues, signalPeriod);
  const signalValue = signalSeries[signalSeries.length - 1];
  const macdValue = macdValues[macdValues.length - 1];
  const prevMacdValue = macdValues[macdValues.length - 2];
  const prevSignalValue = signalSeries[signalSeries.length - 2];

  return {
    macd: macdValue,
    signal: signalValue,
    histogram: macdValue - signalValue,
    // Did MACD cross below signal on the most recent candle? (bearish crossover)
    bearishCrossover:
      prevMacdValue != null &&
      prevSignalValue != null &&
      prevMacdValue >= prevSignalValue &&
      macdValue < signalValue,
    bullishCrossover:
      prevMacdValue != null &&
      prevSignalValue != null &&
      prevMacdValue <= prevSignalValue &&
      macdValue > signalValue,
  };
}

/** True Range series (one shorter than the candle array). */
function trueRangeSeries(candles) {
  const out = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prevClose = candles[i - 1].close;
    out.push(Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose),
    ));
  }
  return out;
}

/** Wilder-smoothed ATR series, aligned to candles[1..] (index 0 has no ATR). */
function atrSeries(candles, period) {
  const tr = trueRangeSeries(candles);
  if (tr.length < period) return [];
  const out = new Array(tr.length).fill(null);
  let atrVal = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = atrVal;
  for (let i = period; i < tr.length; i++) {
    atrVal = (atrVal * (period - 1) + tr[i]) / period;
    out[i] = atrVal;
  }
  return out; // out[k] corresponds to candles[k + 1]
}

/**
 * Supertrend indicator — full recursive computation (not a single-candle
 * approximation), returns:
 *   { value, direction, flippedBullish, flippedBearish }
 * direction: "bullish" (price above the trend line) | "bearish" (below).
 * flipped*: true only on the candle where the trend just switched — this
 * is the meaningful "signal" moment, not just the current direction.
 */
export function supertrend(candles, period = 10, multiplier = 3) {
  if (candles.length < period + 2) return null;

  const atrVals = atrSeries(candles, period); // atrVals[k] -> candles[k + 1]
  const n = candles.length;
  const startIdx = period; // first index in `candles` with a valid ATR

  let finalUpper = null;
  let finalLower = null;
  let trendDir = null; // "bullish" | "bearish"
  let trendValue = null;
  let prevTrendDir = null;

  for (let i = startIdx; i < n; i++) {
    const atrVal = atrVals[i - 1];
    if (atrVal == null) continue;
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const basicUpper = hl2 + multiplier * atrVal;
    const basicLower = hl2 - multiplier * atrVal;
    const close = candles[i].close;
    const prevClose = candles[i - 1].close;

    const newFinalUpper =
      finalUpper == null || basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
    const newFinalLower =
      finalLower == null || basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;

    prevTrendDir = trendDir;

    if (trendDir === null) {
      trendDir = close >= newFinalLower ? "bullish" : "bearish"; // seed on first computable candle
    } else if (trendDir === "bearish" && close > newFinalUpper) {
      trendDir = "bullish";
    } else if (trendDir === "bullish" && close < newFinalLower) {
      trendDir = "bearish";
    }
    // else: trend continues unchanged

    trendValue = trendDir === "bullish" ? newFinalLower : newFinalUpper;
    finalUpper = newFinalUpper;
    finalLower = newFinalLower;
  }

  if (trendDir == null) return null;

  return {
    value: trendValue,
    direction: trendDir,
    flippedBullish: prevTrendDir === "bearish" && trendDir === "bullish",
    flippedBearish: prevTrendDir === "bullish" && trendDir === "bearish",
  };
}
