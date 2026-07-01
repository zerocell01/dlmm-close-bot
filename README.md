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
- **Soft signals** (cuma dicek kalau nggak ada hard rule yang fire): RSI
  overbought (dihitung lokal dari histori PnL yang bot kumpulin sendiri, nggak
  butuh API OHLCV eksternal) + low yield (fee/value terlalu kecil terlalu lama).
- **Confirm-tick gating** — sinyal exit harus konsisten N tick berturut-turut
  (default 2) sebelum bener-bener dieksekusi, biar nggak kepancing noise satu
  data point.
- **State persisten** (`state.json`) — peak PnL, status trailing, timer OOR,
  histori harga buat RSI — semua disimpen ke disk, jadi kalau bot restart
  nggak kehilangan progress tracking.

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
npm start
```

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
| `softSignals.rsi.overboughtLevel` | 75 | Level RSI buat preventive exit |
| `softSignals.lowYield.minFeePerValuePct24hEquiv` | 3 | Minimum fee yield (24h-equivalent %) sebelum dianggap nggak worth |

Ubah nilai di `config.json`, restart bot — nggak perlu ubah `config.js`.

## Yang perlu lo tau soal desain ini

- **RPC**: `RPC_URL` (buat kirim transaksi) sebaiknya RPC berbayar/reliable
  (Helius dll). `POLL_RPC_URL` (buat baca posisi tiap 5 detik) defaultnya
  endpoint publik — read-only, low volume, aman pake gratisan.
- **Nggak ada auto-deploy** — bot ini murni close-only. Kalau posisi lo abis
  ditutup, bot nggak akan buka posisi baru; lo yang deploy manual lagi kalau
  mau.
- **RSI di sini itu proxy, bukan indikator harga token murni** — dihitung
  dari histori PnL% posisi yang bot amatin sendiri (bukan candle OHLCV token).
  Ini pilihan desain biar nggak butuh API eksternal tambahan, tapi artinya
  butuh warm-up period (`period + 1` tick, default 15 tick × 5 detik ≈ 75
  detik) sebelum RSI mulai kebaca, dan resolusinya ngikutin poll interval
  bukan candle timeframe standar.
- **Private key** cuma didecode di memory buat sign transaksi lokal — nggak
  dikirim atau di-log kemanapun.

## Struktur file

```
config.js / config.json   → semua threshold, gampang di-tuning
wallet.js                 → koneksi RPC (tx vs poll dipisah) + wallet keypair
positions.js               → auto-discover posisi wallet + enrich PnL
state.js                   → persist peak/trailing/OOR/histori (survive restart)
indicators.js              → RSI lokal
rules.js                   → engine keputusan close (hard rules → soft signals)
executor.js                 → eksekusi close (claim fee → remove liquidity)
notify.js                   → notifikasi Telegram opsional
index.js                    → main loop
```

## Extend lebih lanjut

- Ganti sumber RSI ke OHLCV API eksternal (misal DexScreener/Birdeye) kalau
  mau indikator yang lebih "bersih" dibanding proxy PnL.
- Tambah preset indikator lain (Supertrend, Bollinger) dengan pola yang sama
  kayak `rsi.enabled` di `softSignals`.
- Tambah scope per-pool (misal threshold beda buat pool stabil vs memecoin)
  dengan nge-lookup `position.pool` ke config override.
