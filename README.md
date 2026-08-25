# Coin Secret

Coin Secret adalah aplikasi analisis teknikal kripto berbasis aturan. Sistem menyediakan supply/demand scanner, paket Free/Premium, panel admin, arsip bukti hasil setup, dan pembayaran. Coin Secret tidak mengeksekusi transaksi.

## Stack

- Next.js 16 App Router dan React 19.
- PostgreSQL 17 dan Prisma ORM 7.
- Better Auth untuk email/password, session database, verifikasi, dan reset password.
- Midtrans Snap atau NOWPayments untuk pembayaran Premium 30 hari, dipilih lewat `PAYMENT_PROVIDER`.
- Brevo untuk email transaksional production.

## Struktur

```text
src/
├── app/               # Route, page, dan composition root Next.js
├── config/            # Konfigurasi statis
├── core/
│   ├── application/   # Use case dan port
│   └── domain/        # Model dan aturan bisnis murni
├── infrastructure/    # Database, auth, billing, email, market adapter
├── presentation/      # UI, hook, layout, dan feature
└── shared/            # Utilitas lintas lapisan
```

Detail tersedia di [`docs/architecture.md`](docs/architecture.md) dan [`docs/backend.md`](docs/backend.md).

## Menjalankan lokal

Persyaratan: Node.js 24, npm, dan Docker Desktop.

```bash
npm ci
docker compose up -d postgres
npm run db:migrate -- --name init
npm run db:seed
npm run dev
```

Salin `.env.example` menjadi `.env` dan ganti seluruh secret. Database lokal tersedia pada port `5433`.

Seed development membuat:

- `free@coinsecret.local` — USER/FREE.
- `premium@coinsecret.local` — USER/PREMIUM.
- `admin@coinsecret.local` — ADMIN/PREMIUM.

Password hanya berasal dari `SEED_USER_PASSWORD` dan `SEED_ADMIN_PASSWORD`. Jangan menjalankan seed demo pada production.

## Route utama

- `/login`, `/register` — autentikasi.
- `/pricing` — perbandingan Free dan Premium.
- `/account` — profil, paket, dan checkout Premium.
- `/admin` — backoffice khusus role ADMIN, termasuk arsip bukti hasil setup.
- `/api/auth/*` — endpoint Better Auth.
- `/api/cron/setup-capture` — memotret hasil setup untuk arsip backoffice, dilindungi `CRON_SECRET`.
- `/api/billing/*` — checkout, histori, dan webhook tiap penyedia pembayaran.
- `/api/admin/*` — user, role, plan, feature gate, audit, dan statistik.

## Chart

Interval candle (`15m`, `1H`, `4H`, `1D`) dan rentang histori (`1M`, `3M`, `1Y`, `ALL`) berdiri sendiri. Setiap kombinasi tersedia, sehingga `ALL` dapat dipakai pada interval mana pun.

Rentang dipecah menjadi halaman yang dimuat paralel dari waktu listing, bukan dengan menelusuri mundur satu per satu. Halaman terbaru dimuat lebih dulu agar chart langsung dapat dipakai, sisanya menyusul di latar belakang dengan indikator progres.

## Verifikasi

```bash
npm run check
npm audit
```

Status setup chart tetap disimpan lokal per browser. Identitas, session, paket, pembayaran, feature gate, audit log, dan arsip bukti hasil setup disimpan di PostgreSQL.
