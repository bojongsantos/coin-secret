# Coin Secret Architecture

Coin Secret memakai Clean Architecture pragmatis untuk aplikasi Next.js.

## Struktur

```text
src/
├── app/               # Routing dan composition root Next.js
├── config/            # Konfigurasi statis aplikasi
├── core/
│   ├── application/   # Use case, ports, dan orchestration
│   └── domain/        # Model dan aturan bisnis murni
├── infrastructure/    # HTTP provider dan persistence adapters
├── presentation/      # React UI, hooks, layout, dan feature views
└── shared/            # Utilitas murni lintas fitur
```

## Arah dependensi

```text
app/presentation → application → domain
app/presentation → infrastructure → application ports
config/shared → tidak bergantung pada feature atau framework
```

Aturan wajib:

- `core/domain` tidak boleh mengimpor React, Next.js, browser API, storage, atau network client.
- `core/application` tidak boleh mengimpor React atau komponen presentasi.
- `infrastructure` mengimplementasikan port dan boleh bergantung pada domain.
- `presentation` tidak menyimpan aturan bisnis atau memanggil provider eksternal langsung.
- `app` hanya menangani routing, metadata, boundary, dan dependency composition.
- Import lintas lapisan memakai alias `@/` yang menunjuk ke `src/`.

## Penempatan file

- Aturan harga, indikator, setup, dan conviction: `core/domain/analysis`.
- Batas paket dan katalog kemampuan: `core/domain/access`.
- Rate limit endpoint mahal: `core/application/rate-limit`.
- Pemicu dan penggambaran bukti hasil setup: `core/domain/promo`.
- Konstanta timeframe dan operasi candle: `core/domain/market`.
- Use case scanner dan validasi request: `core/application/scanner`.
- Perencanaan histori chart dan kebijakan failover provider: `core/application/market-data`.
- Adapter bursa dan agregasi market context: `infrastructure/market-data`.
- Sweep penangkapan hasil setup terjadwal: `infrastructure/monitoring`.
- PostgreSQL/Prisma: `infrastructure/database` dan `prisma/`.
- Auth/session: `infrastructure/auth`.
- Payment gateway: port di `core/application/ports`, adapter di `infrastructure/billing`.
- localStorage hanya untuk snapshot setup chart yang bersifat perangkat-lokal.
- Hook React: `presentation/hooks`.
- Komponen reusable tanpa business rule: `presentation/ui`.
- Halaman dan route handler tidak boleh berisi implementasi use case.

## File root yang sengaja dipertahankan

`AGENTS.md`, `CLAUDE.md`, file konfigurasi, `.env.example`, dan `package.json`
harus tetap di root. Tooling dan Next.js menemukan file tersebut dari lokasi baku.
