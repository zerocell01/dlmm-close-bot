/**
 * Lightweight RSI computed purely from price ticks this bot has observed
 * during its own polling — no external OHLCV API needed. Trade-off: it
 * needs a warm-up period (period + 1 samples) before it means anything,
 * and it reflects poll-interval-resolution price action, not clean
 * candles. Treat it as a soft confirmation signal, never a hard trigger.
 */
export function computeRsi(priceHistory, period = 14) {
  if (!Array.isArray(priceHistory) || priceHistory.length < period + 1) {
    return null; // not enough samples yet
  }
  const prices = priceHistory.slice(-(period + 1)).map((p) => p.price);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
