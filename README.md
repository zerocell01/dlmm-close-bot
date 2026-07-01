# DLMM Close Bot

Standalone auto-close monitor untuk posisi Meteora DLMM. **Open posisi tetap
manual** (lewat app.meteora.ag atau tools lain) — bot ini cuma mantau posisi
yang udah lo buka dan mutusin kapan close-nya, otomatis.

Diadaptasi dari pola yang dipake project [Meridian](https://github.com/yunus-0x/meridian)
(deterministic close rules, trailing take-profit dengan peak-confirmation,
OOR handling), tapi standalone — nggak butuh LLM, nggak butuh infra
proprietary Meridian.

## Cara kerja singkat

- **Polling cepat (default 5 detik)** — pure RPC read + arithmetic, nggak ada
  panggilan LLM sama sekali. Discover posisi wallet lo otomatis
  (`getProgramAccounts` filtered by owner), jadi nggak perlu register posisi
  manual.
- **Hard rules** (selalu menang, urutan prioritas): stop loss → far-above-range
  → trailing take-profit drop → static take-profit → out-of-range timeout.
- **Soft signals** (cuma dicek kalau nggak ada hard rule yang fire, dan cuma
  kalau posisi udah profit): **multi-indicator confluence** — RSI, Bollinger
  Bands, MACD, Supertrend, dan **Fibonacci retracement rejection**, dihitung
  dari candle harga asli (via **endpoint OHLCV resmi Meteora sendiri**,
  gratis, no API key, rate limit 30 request/detik — dengan GeckoTerminal
  sebagai fallback kalau Meteora lagi down), masing-masing "voting"
  bearish/nggak. Close cuma fire kalau minimal N indikator setuju (default
  2) — satu indikator doang yang "stretched" nggak cukup buat trigger close.
  Plus low yield (fee/value terlalu kecil terlalu lama).
- **Indikator mana aja yang aktif itu bisa lo pilih sendiri** lewat menu
  interaktif (`npm run menu`) — nggak perlu edit `config.json` manual.
- **Confirm-tick gating** — sinyal exit harus konsisten N tick berturut-turut
  (default 2) sebelum bener-bener dieksekusi, biar nggak kepancing noise satu
  data point.
- **State persisten** (`state.json`) — peak PnL, status trailing, timer OOR,
  disimpen ke disk, jadi kalau bot restart nggak kehilangan progress
  tracking. Data candle indikator **nggak** disimpen di sini — itu cuma
  di-cache di memory (`ohlcv.js`), aman di-refresh ulang tiap restart.

## Setup

```bash
npm install
cp .env.example .env
# isi WALLET_PRIVATE_KEY dan RPC_URL di .env
```

**WAJIB: test dengan `DRY_RUN=true` dulu** (default-nya udah `true`). Bot akan
jalan penuh — discover posisi, evaluasi rules, log keputusan — tapi nggak
kirim transaksi apapun. Perhatiin log-nya beberapa siklus, pastiin
keputusannya masuk akal, baru set `DRY_RUN=false`.

```bash
npm start          # jalan di foreground, log langsung ke terminal — enak buat testing awal
```

Atau, buat pemakaian sehari-hari, jalanin lewat menu (lihat bagian di bawah)
biar bot jalan di background dan lo bisa tetep pake terminal buat hal lain.

## Update ke versi terbaru / push perubahan

Kalau lo ubah kode atau config dan mau commit+push ke GitHub, tinggal:

```bash
chmod +x update.sh   # sekali aja
./update.sh                              # commit message otomatis (timestamp)
./update.sh "ubah stop loss jadi -20%"   # atau custom message
```

Script ini otomatis nolak jalan kalau `.env` ketauan nggak ke-`.gitignore` —
jadi private key nggak akan pernah ke-push tanpa sengaja.

## Menu interaktif — kontrol semua dari sini

```bash
npm run menu
```

Menu ini jadi pusat kontrol bot, nggak perlu edit `config.json` manual atau
`Ctrl+C` terminal buat stop:

**Exit rules:**
- `sl` — ubah stop loss %
- `tp` — ubah take profit % (fallback kalau trailing off)
- `t` — toggle trailing take-profit on/off
- `tg` — ubah trailing trigger % (PnL buat mulai "lock" peak)
- `td` — ubah trailing drop % (seberapa turun dari peak buat trigger close)
- `oor` — ubah toleransi waktu out-of-range (menit)

**Indikator:**
- `1`-`5` — toggle RSI / Bollinger / MACD / Supertrend / Fibonacci on/off
- `m` — ubah berapa indikator harus setuju sebelum close
- `p` — ubah PnL minimum sebelum indikator dipertimbangkan
- `y` — toggle low yield close

**Polling:**
- `iv` — ubah poll interval (detik)
- `ct` — ubah confirm ticks (berapa kali sinyal harus konsisten)

**Kontrol bot:**
- `r` — start bot (jalan di background, log ke `bot.log`)
- `x` — stop bot

**Lainnya:**
- `s` — simpan & keluar
- `q` — keluar tanpa simpan

Menu-nya nunjukin status bot (RUNNING/STOPPED) dan mode (DRY_RUN/LIVE) di
bagian atas, jadi lo selalu tau kondisi bot sebelum ubah apapun. Kalau nyimpen
config baru sementara bot lagi jalan, dia ngingetin buat stop (`x`) terus
start (`r`) lagi biar config barunya kepake — bot yang lagi jalan nggak
otomatis reload config.

Validasi juga ada di tiap field (misal stop loss harus negatif, take profit
harus positif) — input yang nggak valid ditolak dan nilai lama tetep dipake.

## Konfigurasi (`config.json`)

Semua threshold ada di `config.json`, nggak perlu edit kode buat tuning:

| Field | Default | Arti |
|---|---|---|
| `pollIntervalSec` | 5 | Seberapa sering cek posisi (detik) |
| `confirmTicks` | 2 | Berapa kali sinyal harus konsisten sebelum dieksekusi |
| `hardRules.stopLossPct` | -15 | Close kalau PnL turun ke/lebih rendah dari ini |
| `hardRules.takeProfitPct` | 8 | Close kalau PnL naik ke/lebih tinggi (fallback kalau trailing off) |
| `hardRules.trailing.enabled` | true | Aktifin trailing take-profit |
| `hardRules.trailing.triggerPct` | 3 | PnL % buat mulai "lock" peak |
| `hardRules.trailing.dropPct` | 1.5 | Drop dari peak buat trigger close |
| `hardRules.farAboveRangeBins` | 10 | Berapa bin di atas upper sebelum dianggap "exposure maksimal" |
| `hardRules.outOfRangeWaitMinutes` | 30 | Toleransi waktu OOR sebelum nyerah dan close |
| `softSignals.indicators.minSignalsAgree` | 2 | Berapa indikator harus setuju bearish sebelum preventive close |
| `softSignals.indicators.minPnlPctToAct` | 1 | PnL minimum sebelum indikator boleh dipertimbangkan (nggak pernah dipake buat nutup posisi rugi) |
| `softSignals.indicators.rsi.overbought` | 75 | Level RSI dianggap "voting" bearish |
| `softSignals.indicators.bollinger.stdDevMult` | 2 | Lebar band Bollinger (dalam std dev) |
| `softSignals.indicators.macd.*` | 12/26/9 | Periode fast/slow/signal standar MACD |
| `softSignals.indicators.supertrend.*` | period 10, multiplier 3 | Parameter standar Supertrend |
| `softSignals.indicators.fibonacci.lookback` | 50 | Berapa candle ke belakang buat nentuin swing high/low |
| `softSignals.indicators.fibonacci.ratios` | 0.236/0.382/0.5/0.618/0.786 | Level retracement standar yang dicek |
| `softSignals.lowYield.minFeePerValuePct24hEquiv` | 3 | Minimum fee yield (24h-equivalent %) sebelum dianggap nggak worth |

Cara paling gampang ubah kebanyakan nilai di atas: `npm run menu` (lihat
bagian di atas), daripada edit `config.json` manual.

Ubah nilai di `config.json`, restart bot — nggak perlu ubah `config.js`.

## Yang perlu lo tau soal desain ini

- **RPC**: `RPC_URL` (buat kirim transaksi) sebaiknya RPC berbayar/reliable
  (Helius dll) — ini yang motong kuota kredit bulanan lo. `POLL_RPC_URL`
  (buat baca posisi tiap 5 detik) defaultnya endpoint publik gratis
  (`pump.helius-rpc.com`) — endpoint ini **terpisah total** dari API key
  berbayar lo, jadi polling sesering apapun nggak motong kredit sama sekali.
  Trade-off-nya: endpoint publik itu shared (rate limit ~100-200 req/detik
  per IP, nggak ada SLA), tapi buat beberapa posisi itu jauh di bawah limit
  jadi aman.
- **Nggak ada auto-deploy** — bot ini murni close-only. Kalau posisi lo abis
  ditutup, bot nggak akan buka posisi baru; lo yang deploy manual lagi kalau
  mau.
- **Indikator dihitung dari candle harga token beneran** — sumber utamanya
  **endpoint OHLCV resmi Meteora** (`dlmm.datapi.meteora.ag`, domain yang sama
  yang udah dipake `positions.js` buat data PnL), bukan proxy PnL. Kenapa
  Meteora dan bukan GeckoTerminal/Jupiter/GMGN: Jupiter nggak punya endpoint
  candle sama sekali (cuma harga spot); GMGN punya tapi butuh signup + API
  key dan rate limit publiknya cuma 1 request/detik; GeckoTerminal works
  tapi itu indexer pihak ketiga yang bisa telat nge-index pool token yang
  baru banget launch. Meteora otoritatif buat pool-nya sendiri dan rate
  limit-nya (30 req/detik) jauh lebih longgar. GeckoTerminal tetep dipasang
  sebagai **fallback otomatis** kalau endpoint Meteora lagi down. Data
  di-cache per pool (default 60 detik) biar nggak spam kedua API walau lo
  punya beberapa posisi sekaligus. Kalau fetch candle gagal total, bot
  **skip** cek indikator buat tick itu — nggak pernah nganggep "no data"
  sebagai sinyal bearish.
- **Supertrend pake algoritma rekursif standar** (bukan aproksimasi 1-candle)
  — running final-band dan trend-state di-track across seluruh histori
  candle, dengan deteksi "baru aja flip" (`flippedBearish`) yang lebih kuat
  signalnya dibanding "udah bearish dari lama."
- **Indikator itu soft signal, bukan hard rule** — bot cuma mempertimbangkan
  sinyal indikator kalau posisi **udah profit** (`minPnlPctToAct`). Nggak
  akan pernah dipake buat nutup posisi yang lagi rugi — itu tugasnya stop
  loss (hard rule).
- **Private key** cuma didecode di memory buat sign transaksi lokal — nggak
  dikirim atau di-log kemanapun.

## Struktur file

```
config.js / config.json   → semua threshold, gampang di-tuning
wallet.js                 → koneksi RPC (tx vs poll dipisah) + wallet keypair
positions.js               → auto-discover posisi wallet + enrich PnL
state.js                   → persist peak/trailing/OOR (survive restart)
ohlcv.js                    → fetch+cache candle harga (Meteora resmi, fallback GeckoTerminal)
indicators.js               → math RSI/Bollinger/MACD/Supertrend (pure functions)
signals.js                  → gabungin indikator jadi voting/confluence
rules.js                    → engine keputusan close (hard rules → soft signals)
executor.js                 → eksekusi close (claim fee → remove liquidity)
notify.js                   → notifikasi Telegram opsional
index.js                    → main loop
update.sh                   → commit+push satu command (lihat bagian Update di atas)
menu.js                      → menu interaktif buat toggle indikator/rules (npm run menu)
```

## Extend lebih lanjut

- Tambah indikator lain (misal Fibonacci retracement, ADX, Stochastic) di
  `indicators.js` sebagai pure function baru, terus daftarin votingnya di
  `signals.js` — polanya udah konsisten (return `{ ..., bearish: bool }`).
- Bedain bobot per indikator (misal Supertrend lebih "berat" daripada RSI)
  dengan ganti simple vote-count di `signals.js` jadi weighted score.
- Tambah scope per-pool (misal threshold beda buat pool stabil vs memecoin)
  dengan nge-lookup `position.pool` ke config override.
- Kalau rate-limit OHLCV jadi masalah (banyak posisi sekaligus), naikin
  `cacheTtlSec` — `getCandles()` di `ohlcv.js` udah otomatis coba Meteora
  dulu baru fallback ke GeckoTerminal, jadi biasanya nggak perlu ganti
  provider manual kecuali kedua-duanya kena limit bareng.
