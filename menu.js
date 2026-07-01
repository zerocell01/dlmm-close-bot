import "dotenv/config";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");
const PID_PATH = path.join(__dirname, "bot.pid");
const LOG_PATH = path.join(__dirname, "bot.log");
const INDEX_PATH = path.join(__dirname, "index.js");

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

const INDICATOR_ITEMS = [
  { key: "rsi", label: "RSI — overbought reversal" },
  { key: "bollinger", label: "Bollinger Bands — upper band touch" },
  { key: "macd", label: "MACD — bearish crossover" },
  { key: "supertrend", label: "Supertrend — trend flip" },
  { key: "fibonacci", label: "Fibonacci — resistance rejection" },
];

function checkbox(enabled) {
  return enabled ? "[x]" : "[ ]";
}

// ── Bot process control ──────────────────────────────────────────────
// Menu and bot run as separate Node processes. State of "is it running"
// is tracked via a PID file, same pattern pm2/systemd use under the hood
// but dependency-free — no extra package needed just for this.

function getBotStatus() {
  if (!fs.existsSync(PID_PATH)) return { running: false };
  const raw = fs.readFileSync(PID_PATH, "utf8").trim();
  const pid = parseInt(raw, 10);
  if (!Number.isFinite(pid)) {
    fs.unlinkSync(PID_PATH);
    return { running: false };
  }
  try {
    // Signal 0 doesn't actually send a signal — just checks the process exists.
    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    fs.unlinkSync(PID_PATH); // stale pid file from a previous crash/reboot
    return { running: false };
  }
}

function startBot() {
  const status = getBotStatus();
  if (status.running) {
    console.log(`\nBot udah jalan (PID ${status.pid}). Stop dulu (x) kalau mau restart.`);
    return;
  }
  const logFd = fs.openSync(LOG_PATH, "a");
  const child = spawn(process.execPath, [INDEX_PATH], {
    cwd: __dirname,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  child.unref();
  fs.writeFileSync(PID_PATH, String(child.pid));
  console.log(`\nBot dijalankan di background (PID ${child.pid}).`);
  console.log(`Log: ${LOG_PATH}  (pantau dengan: tail -f bot.log)`);
}

function stopBot() {
  const status = getBotStatus();
  if (!status.running) {
    console.log("\nBot nggak lagi jalan.");
    return;
  }
  try {
    // Note: on Windows this terminates immediately (no graceful SIGTERM
    // semantics like Linux) — fine here since the bot has no in-flight
    // state that depends on a clean shutdown: open-position tracking is
    // re-derived from chain data on every restart, not kept in a
    // "waiting to confirm" flag that could get corrupted by a hard kill.
    process.kill(status.pid, "SIGTERM");
    fs.unlinkSync(PID_PATH);
    console.log(`\nBot (PID ${status.pid}) dihentikan.`);
  } catch (e) {
    console.log(`\nGagal stop bot: ${e.message}`);
  }
}

function render(cfg) {
  const ind = cfg.softSignals.indicators;
  const hr = cfg.hardRules;
  const status = getBotStatus();
  const dryRun = (process.env.DRY_RUN ?? "true") === "true";

  console.log("\n=== DLMM Close Bot — Menu Konfigurasi ===\n");
  console.log(`Bot status: ${status.running ? `● RUNNING (PID ${status.pid})` : "○ STOPPED"}   Mode: ${dryRun ? "DRY_RUN (aman, no tx)" : "⚠️  LIVE (kirim transaksi asli)"}`);

  console.log("\nExit rules:");
  console.log(`  sl.  Stop loss:              ${hr.stopLossPct}%`);
  console.log(`  tp.  Take profit (fallback): ${hr.takeProfitPct}%`);
  console.log(`  ${checkbox(hr.trailing.enabled)} t.  Trailing take-profit`);
  console.log(`  tg.    - trigger (mulai lock peak di PnL):  ${hr.trailing.triggerPct}%`);
  console.log(`  td.    - drop dari peak buat close:         ${hr.trailing.dropPct}%`);
  console.log(`  oor. Out-of-range wait: ${hr.outOfRangeWaitMinutes}m`);

  console.log("\nIndikator (soft signal — cuma dipertimbangkan kalau posisi udah profit):");
  INDICATOR_ITEMS.forEach((item, i) => {
    console.log(`  ${checkbox(ind[item.key]?.enabled)} ${i + 1}. ${item.label}`);
  });
  console.log(`  Minimal indikator harus setuju: ${ind.minSignalsAgree}   |   PnL minimum buat aktif: ${ind.minPnlPctToAct}%`);
  console.log(`  ${checkbox(cfg.softSignals.lowYield.enabled)} y.  Low yield close`);

  console.log("\nPolling:");
  console.log(`  iv.  Poll interval: ${cfg.pollIntervalSec}s   |   ct.  Confirm ticks: ${cfg.confirmTicks}`);

  console.log("\nBot control:");
  console.log(`  r.   Start bot (background)`);
  console.log(`  x.   Stop bot`);

  console.log("\nLainnya:");
  console.log("  [1-5]  toggle indikator on/off");
  console.log("  m.     ubah jumlah minimal indikator yang harus setuju");
  console.log("  p.     ubah PnL minimum sebelum indikator dipertimbangkan");
  console.log("  s.     simpan & keluar");
  console.log("  q.     keluar tanpa menyimpan");
}

function prompt(text) {
  process.stdout.write(text);
}

// Field editors — each entry maps a command to where in `cfg` it writes
// and how to parse/validate the typed value.
function numericFieldEditor(path_, { label, parse = parseFloat, validate = () => true }) {
  return {
    label,
    apply(cfg, value) {
      const n = parse(value);
      if (!Number.isFinite(n) || !validate(n)) return false;
      let obj = cfg;
      for (let i = 0; i < path_.length - 1; i++) obj = obj[path_[i]];
      obj[path_[path_.length - 1]] = n;
      return true;
    },
  };
}

const FIELD_EDITORS = {
  sl: numericFieldEditor(["hardRules", "stopLossPct"], { label: "stop loss %", validate: (n) => n < 0 }),
  tp: numericFieldEditor(["hardRules", "takeProfitPct"], { label: "take profit %", validate: (n) => n > 0 }),
  tg: numericFieldEditor(["hardRules", "trailing", "triggerPct"], { label: "trailing trigger %", validate: (n) => n > 0 }),
  td: numericFieldEditor(["hardRules", "trailing", "dropPct"], { label: "trailing drop %", validate: (n) => n > 0 }),
  oor: numericFieldEditor(["hardRules", "outOfRangeWaitMinutes"], { label: "out-of-range wait (menit)", parse: (v) => parseInt(v, 10), validate: (n) => n >= 0 }),
  iv: numericFieldEditor(["pollIntervalSec"], { label: "poll interval (detik)", parse: (v) => parseInt(v, 10), validate: (n) => n >= 1 }),
  ct: numericFieldEditor(["confirmTicks"], { label: "confirm ticks", parse: (v) => parseInt(v, 10), validate: (n) => n >= 1 }),
};

async function main() {
  const rl = readline.createInterface({ input, output, terminal: false });
  const cfg = loadConfig();
  let dirty = false;
  // Tracks whether we're waiting for a follow-up answer (avoids nested/
  // repeated rl.question() calls, which are unreliable across Node
  // versions with piped/non-TTY stdin — a single continuous line-by-line
  // loop is the robust pattern instead).
  let pending = null;

  render(cfg);
  prompt("\nPilih: ");

  for await (const rawLine of rl) {
    const answer = rawLine.trim().toLowerCase();
    const ind = cfg.softSignals.indicators;

    // ── Resolve a pending follow-up value ──────────────────────────
    if (pending && pending.startsWith("field:")) {
      const key = pending.slice("field:".length);
      const editor = FIELD_EDITORS[key];
      const ok = editor.apply(cfg, answer);
      if (ok) dirty = true;
      else console.log("Nilai nggak valid, diabaikan.");
      pending = null;
      render(cfg);
      prompt("\nPilih: ");
      continue;
    }

    if (pending === "minSignalsAgree") {
      const n = parseInt(answer, 10);
      if (Number.isFinite(n) && n > 0) {
        ind.minSignalsAgree = n;
        dirty = true;
      } else {
        console.log("Nilai nggak valid, diabaikan.");
      }
      pending = null;
      render(cfg);
      prompt("\nPilih: ");
      continue;
    }

    if (pending === "minPnlPctToAct") {
      const n = parseFloat(answer);
      if (Number.isFinite(n)) {
        ind.minPnlPctToAct = n;
        dirty = true;
      } else {
        console.log("Nilai nggak valid, diabaikan.");
      }
      pending = null;
      render(cfg);
      prompt("\nPilih: ");
      continue;
    }

    if (pending === "confirmQuit") {
      pending = null;
      if (answer === "y") {
        console.log("\nKeluar tanpa menyimpan.");
        break;
      }
      render(cfg);
      prompt("\nPilih: ");
      continue;
    }

    // ── Top-level commands ──────────────────────────────────────────
    if (/^[1-5]$/.test(answer)) {
      const item = INDICATOR_ITEMS[parseInt(answer, 10) - 1];
      if (!ind[item.key]) ind[item.key] = { enabled: false };
      ind[item.key].enabled = !ind[item.key].enabled;
      dirty = true;
      render(cfg);
      prompt("\nPilih: ");
    } else if (FIELD_EDITORS[answer]) {
      const editor = FIELD_EDITORS[answer];
      pending = `field:${answer}`;
      prompt(`Nilai baru untuk ${editor.label}: `);
    } else if (answer === "m") {
      pending = "minSignalsAgree";
      prompt(`Nilai baru minSignalsAgree (sekarang ${ind.minSignalsAgree}): `);
    } else if (answer === "p") {
      pending = "minPnlPctToAct";
      prompt(`Nilai baru minPnlPctToAct (sekarang ${ind.minPnlPctToAct}%): `);
    } else if (answer === "t") {
      cfg.hardRules.trailing.enabled = !cfg.hardRules.trailing.enabled;
      dirty = true;
      render(cfg);
      prompt("\nPilih: ");
    } else if (answer === "y") {
      cfg.softSignals.lowYield.enabled = !cfg.softSignals.lowYield.enabled;
      dirty = true;
      render(cfg);
      prompt("\nPilih: ");
    } else if (answer === "r") {
      if (dirty) {
        console.log("\nAda perubahan belum disimpan — simpan dulu (s) sebelum start, biar bot pake config terbaru.");
      } else {
        startBot();
      }
      render(cfg);
      prompt("\nPilih: ");
    } else if (answer === "x") {
      stopBot();
      render(cfg);
      prompt("\nPilih: ");
    } else if (answer === "s") {
      const enabledCount = INDICATOR_ITEMS.filter((item) => ind[item.key]?.enabled).length;
      if (enabledCount > 0 && ind.minSignalsAgree > enabledCount) {
        console.log(
          `\nPERINGATAN: minSignalsAgree (${ind.minSignalsAgree}) lebih besar dari jumlah indikator ` +
            `yang aktif (${enabledCount}) — indikator nggak akan pernah bisa trigger close. Disesuaikan ke ${enabledCount}.`,
        );
        ind.minSignalsAgree = enabledCount;
      }
      if (cfg.hardRules.trailing.enabled && cfg.hardRules.trailing.triggerPct >= cfg.hardRules.takeProfitPct) {
        console.log(
          `\nCatatan: trailing trigger (${cfg.hardRules.trailing.triggerPct}%) >= take profit fallback ` +
            `(${cfg.hardRules.takeProfitPct}%) — trailing bakal aktif duluan sebelum static TP sempet kena, ini normal kalau memang itu maunya.`,
        );
      }
      saveConfig(cfg);
      dirty = false;
      const status = getBotStatus();
      console.log(
        status.running
          ? "\nTersimpan ke config.json. Bot masih jalan pake config LAMA — stop (x) lalu start (r) lagi biar config baru kepake."
          : "\nTersimpan ke config.json.",
      );
      break;
    } else if (answer === "q") {
      if (dirty) {
        pending = "confirmQuit";
        prompt("Ada perubahan belum disimpan. Yakin keluar tanpa simpan? (y/n): ");
      } else {
        console.log("\nKeluar tanpa menyimpan.");
        break;
      }
    } else {
      console.log("Pilihan nggak dikenali.");
      render(cfg);
      prompt("\nPilih: ");
    }
  }

  rl.close();
}

main();
