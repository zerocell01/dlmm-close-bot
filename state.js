import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, "state.json");

let _state = null;

function load() {
  if (_state) return _state;
  if (fs.existsSync(STATE_PATH)) {
    try {
      _state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    } catch {
      _state = {};
    }
  } else {
    _state = {};
  }
  return _state;
}

function persist() {
  fs.writeFileSync(STATE_PATH, JSON.stringify(_state, null, 2));
}

function getOrInit(positionAddress) {
  const s = load();
  if (!s[positionAddress]) {
    s[positionAddress] = {
      peak_pnl_pct: 0,
      pending_peak_pnl_pct: null,
      pending_peak_confirm_count: 0,
      trailing_active: false,
      out_of_range_since: null,
      pending_exit_signal: null,
      pending_exit_confirm_count: 0,
      price_history: [], // [{t, price}] used to compute local RSI
      last_seen_at: new Date().toISOString(),
    };
  }
  return s[positionAddress];
}

export function getPositionState(positionAddress) {
  return getOrInit(positionAddress);
}

/**
 * Raise the confirmed peak PnL only after N consecutive polls where the
 * candidate stays at/above the current peak. Prevents one noisy RPC read
 * from arming a false trailing-drop.
 */
export function confirmPeak(positionAddress, candidatePnlPct, confirmTicks) {
  const s = getOrInit(positionAddress);
  if (candidatePnlPct == null) return;
  const currentPeak = s.peak_pnl_pct ?? 0;

  if (candidatePnlPct < currentPeak) {
    s.pending_peak_pnl_pct = null;
    s.pending_peak_confirm_count = 0;
    persist();
    return;
  }
  if (s.pending_peak_pnl_pct != null && candidatePnlPct >= s.pending_peak_pnl_pct) {
    s.pending_peak_confirm_count = (s.pending_peak_confirm_count ?? 1) + 1;
    s.pending_peak_pnl_pct = candidatePnlPct;
  } else {
    s.pending_peak_pnl_pct = candidatePnlPct;
    s.pending_peak_confirm_count = 1;
  }
  if (s.pending_peak_confirm_count >= confirmTicks) {
    s.peak_pnl_pct = Math.max(currentPeak, s.pending_peak_pnl_pct);
    s.pending_peak_pnl_pct = null;
    s.pending_peak_confirm_count = 0;
  }
  persist();
}

export function setTrailingActive(positionAddress, active) {
  const s = getOrInit(positionAddress);
  s.trailing_active = active;
  persist();
}

export function markOutOfRange(positionAddress) {
  const s = getOrInit(positionAddress);
  if (!s.out_of_range_since) {
    s.out_of_range_since = new Date().toISOString();
    persist();
  }
}

export function markInRange(positionAddress) {
  const s = getOrInit(positionAddress);
  if (s.out_of_range_since) {
    s.out_of_range_since = null;
    persist();
  }
}

export function minutesOutOfRange(positionAddress) {
  const s = getOrInit(positionAddress);
  if (!s.out_of_range_since) return 0;
  return Math.floor((Date.now() - new Date(s.out_of_range_since).getTime()) / 60000);
}

/**
 * Require N consecutive confirming ticks with the SAME exit signal before
 * acting. A signal that changes or disappears resets the counter.
 */
export function registerExitSignal(positionAddress, signal, confirmTicks) {
  const s = getOrInit(positionAddress);
  if (!signal) {
    s.pending_exit_signal = null;
    s.pending_exit_confirm_count = 0;
    persist();
    return { fire: false };
  }
  if (s.pending_exit_signal === signal) {
    s.pending_exit_confirm_count += 1;
  } else {
    s.pending_exit_signal = signal;
    s.pending_exit_confirm_count = 1;
  }
  persist();
  return { fire: s.pending_exit_confirm_count >= confirmTicks };
}

// ── Local price history (for self-computed RSI, no external OHLCV needed) ──
const MAX_PRICE_SAMPLES = 200;

export function recordPriceSample(positionAddress, price) {
  if (price == null || !Number.isFinite(price)) return;
  const s = getOrInit(positionAddress);
  s.price_history.push({ t: Date.now(), price });
  if (s.price_history.length > MAX_PRICE_SAMPLES) {
    s.price_history = s.price_history.slice(-MAX_PRICE_SAMPLES);
  }
  persist();
}

export function getPriceHistory(positionAddress) {
  return getOrInit(positionAddress).price_history;
}

export function removePositionState(positionAddress) {
  const s = load();
  if (s[positionAddress]) {
    delete s[positionAddress];
    persist();
    log("state", `Cleared state for closed position ${positionAddress}`);
  }
}

export function touchPosition(positionAddress) {
  const s = getOrInit(positionAddress);
  s.last_seen_at = new Date().toISOString();
  persist();
}

/** Prune state for positions that are no longer open (avoids unbounded growth). */
export function pruneStaleState(openPositionAddresses) {
  const s = load();
  const openSet = new Set(openPositionAddresses);
  let changed = false;
  for (const addr of Object.keys(s)) {
    if (!openSet.has(addr)) {
      delete s[addr];
      changed = true;
    }
  }
  if (changed) persist();
}
