import { rsi, bollingerBands, macd, supertrend, fibonacciRejection } from "./indicators.js";

/**
 * Evaluate all enabled indicators against a candle set and return a
 * confluence summary. Each indicator votes independently; nothing here
 * closes a position by itself — `rules.js` decides how many votes are
 * required (config.softSignals.indicators.minSignalsAgree) and gates on
 * PnL before acting. This mirrors the "soft signals need 2+ agree" logic
 * explained earlier — no single stretched indicator should trigger a close.
 */
export function evaluateIndicatorSignals(candles, cfg) {
  const details = {};
  let bearishVotes = 0;
  let totalVotes = 0;

  if (cfg.rsi?.enabled) {
    const value = rsi(candles, cfg.rsi.period);
    if (value != null) {
      const bearish = value >= cfg.rsi.overbought;
      details.rsi = { value: round(value), bearish };
      totalVotes++;
      if (bearish) bearishVotes++;
    }
  }

  if (cfg.bollinger?.enabled) {
    const bands = bollingerBands(candles, cfg.bollinger.period, cfg.bollinger.stdDevMult);
    const lastClose = candles[candles.length - 1]?.close;
    if (bands && lastClose != null) {
      const bearish = lastClose >= bands.upper;
      details.bollinger = { upper: round(bands.upper), middle: round(bands.middle), lower: round(bands.lower), close: round(lastClose), bearish };
      totalVotes++;
      if (bearish) bearishVotes++;
    }
  }

  if (cfg.macd?.enabled) {
    const result = macd(candles, cfg.macd.fastPeriod, cfg.macd.slowPeriod, cfg.macd.signalPeriod);
    if (result) {
      const bearish = result.bearishCrossover;
      details.macd = { macd: round(result.macd), signal: round(result.signal), histogram: round(result.histogram), bearishCrossover: bearish };
      totalVotes++;
      if (bearish) bearishVotes++;
    }
  }

  if (cfg.supertrend?.enabled) {
    const result = supertrend(candles, cfg.supertrend.period, cfg.supertrend.multiplier);
    if (result) {
      // A fresh flip to bearish is a stronger signal than "already bearish
      // for a while" (which the position should have reacted to earlier).
      const bearish = result.flippedBearish || result.direction === "bearish";
      details.supertrend = { direction: result.direction, flippedBearish: result.flippedBearish, bearish };
      totalVotes++;
      if (bearish) bearishVotes++;
    }
  }

  if (cfg.fibonacci?.enabled) {
    const result = fibonacciRejection(candles, cfg.fibonacci.lookback, cfg.fibonacci.ratios);
    if (result) {
      const bearish = result.rejected;
      details.fibonacci = {
        rejected: bearish,
        level: result.rejectedLevel?.ratio ?? null,
        price: result.rejectedLevel ? round(result.rejectedLevel.price) : null,
        bearish,
      };
      totalVotes++;
      if (bearish) bearishVotes++;
    }
  }

  return {
    bearishVotes,
    totalVotes,
    details,
    agrees: totalVotes > 0 && bearishVotes >= (cfg.minSignalsAgree ?? 2) && bearishVotes >= totalVotes / 2,
  };
}

function round(v, d = 4) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
