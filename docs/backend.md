# Backend Coin Secret

## Model akses

Role dan paket tidak dicampur:

- Role `USER` memakai aplikasi biasa.
- Role `ADMIN` dapat membuka backoffice.
- Plan `FREE` melihat tiga setup per sisi pada tabel sinyal; sisanya buram.
- Plan `PREMIUM` melihat seluruh setup beserta fitur premium lainnya.

Hak akses fitur diputuskan dalam tiga tingkat oleh `resolveFeatureAccess`. Grant per pengguna menang mutlak, termasuk ketika bernilai menolak, karena penolakan eksplisit adalah cara memutus satu akun tanpa menyentuh akun lain. Berikutnya gate global yang membuka atau menutup fitur bagi seluruh paket tanpa rilis. Bila keduanya tidak tercatat, bawaan statis paket yang berlaku.

Premium yang masa berlakunya habis diturunkan pada permintaan berikutnya, bukan menunggu pekerjaan pembersihan. Premium tanpa periode sama sekali sengaja tidak pernah kedaluwarsa, karena itulah cara admin memberikan akses secara manual.

Admin tidak dapat menurunkan role dirinya sendiri. Tanpa aturan tersebut seorang operator dapat mengunci dirinya keluar dari backoffice dalam satu klik, sementara hanya admin yang dapat mengembalikan role itu. Menurunkan admin lain tetap diizinkan dan tidak dapat mengosongkan ruang, sebab pelakunya selalu mempertahankan rolenya sendiri.

Seluruh endpoint mutasi memeriksa session pada server. Resource per pengguna selalu difilter berdasarkan `userId` untuk mencegah IDOR. Panel admin melakukan pemeriksaan role pada layout dan setiap route API.

## Auth

Better Auth menyimpan user, credential account, session, verification token, dan rate limit di PostgreSQL. Cookie session memakai `HttpOnly`, `SameSite=Lax`, dan `Secure` pada production. Password minimal 10 karakter dan session berlaku tujuh hari.

Aktifkan `REQUIRE_EMAIL_VERIFICATION=true` setelah email terkonfigurasi. Reset password mencabut session lain.

Origin yang boleh menggerakkan endpoint auth berasal dari `BETTER_AUTH_URL` ditambah `TRUSTED_ORIGINS` yang dipisah koma. Ini kendali CSRF, bukan daftar kemudahan: origin yang tercantum dapat mengirim permintaan sign-in dan ganti password dengan membawa cookie pengguna, sehingga daftarnya hanya disusun dari konfigurasi dan nilai yang bukan origin http(s) absolut dibuang, bukan diteruskan.

Satu origin saja cukup selama aplikasi punya satu URL. Begitu domain kedua ditambahkan, setiap sign-in dari domain yang lain gagal dengan `Invalid origin` — galat yang menyebut CSRF padahal sebabnya konfigurasi. Karena itu domain lama yang masih dilayani wajib dicantumkan pada `TRUSTED_ORIGINS`.

Di luar production, alias loopback beserta alamat LAN mesin itu sendiri ikut dipercaya, sebab `next dev` juga mengumumkan URL "Network" dan membukanya menghasilkan galat yang sama. Alamat LAN dibaca dari interface, bukan ditulis manual, karena nilainya berubah mengikuti jaringan yang sedang disambangi. Production tidak mendapat kelonggaran itu.

## Email transaksional

Pengiriman memakai Brevo melalui `BREVO_API_KEY` dan `EMAIL_FROM`, dengan `EMAIL_FROM_NAME` bersifat opsional. Brevo dipilih karena memverifikasi satu alamat pengirim lewat tautan di inbox, sehingga deployment tanpa domain sendiri tetap dapat mengirim. Penyedia yang mewajibkan record DNS tidak dapat dipakai selama aplikasi masih berjalan di subdomain milik platform hosting.

Di luar production, kunci yang kosong mencetak log alih-alih mengirim, agar alur daftar dan reset password tetap dapat dijalankan secara lokal tanpa akun email apa pun. Pada production keadaan tersebut melempar galat, sebab tautan reset yang diam-diam tidak pernah terkirim tampak persis seperti reset yang berhasil bagi orang yang menunggunya.

Kegagalan kiriman melaporkan `code` dan `message` dari Brevo, bukan sekadar status HTTP. Pengirim yang belum diverifikasi adalah kegagalan pertama yang paling mungkin ditemui operator, dan hanya body respons yang menyebutkannya.

Berkas dipecah dua seperti adapter pembayaran: `infrastructure/email/brevo.ts` memuat bentuk payload dan pemetaan galat secara murni sehingga dapat diuji langsung, sedangkan `email-service.ts` menangani jaringan dan menyimpan kunci.

## Billing

Checkout menentukan harga dari `PREMIUM_PRICE_IDR` pada server. Browser tidak dapat menentukan nominal atau mengaktifkan paket.

`PAYMENT_PROVIDER` memilih penyedia yang menagih. Nilai yang tidak dikenali menolak melakukan penagihan alih-alih jatuh ke penyedia yang tidak diminta operator.

### Midtrans

Webhook production:

```text
https://DOMAIN/api/billing/webhook/midtrans
```

Handler memverifikasi `SHA512(order_id + status_code + gross_amount + server_key)`, nominal, status, dan fraud status. Event settlement diproses idempotent. Pembayaran sukses menambah 30 hari pada periode aktif.

Konfigurasikan Notification URL tersebut pada Midtrans MAP. Gunakan Sandbox key sampai QA pembayaran selesai.

### NOWPayments

Memerlukan `NOWPAYMENTS_API_KEY` dan `NOWPAYMENTS_IPN_SECRET`. Keduanya nilai berbeda: IPN secret dibuat terpisah pada Settings > Payments > Instant Payment Notifications. Callback URL yang didaftarkan di sana:

```text
https://DOMAIN/api/billing/webhook/nowpayments
```

`BETTER_AUTH_URL` dipakai sebagai origin publik untuk menyusun callback URL dan halaman kembali, sehingga adapter menolak berjalan bila variabel itu kosong.

Checkout memakai endpoint invoice, bukan endpoint payment, agar NOWPayments yang menyediakan pemilih koin beserta layar alamat dan QR. Membangunnya di dalam aplikasi berarti menyusun ulang kuotasi yang kedaluwarsa, kurs berjalan, dan penghitung konfirmasi untuk setiap koin.

Tanda tangan IPN berupa HMAC-SHA512 atas payload yang kuncinya diurutkan lalu diserialisasi ulang, dikirim pada header `x-nowpayments-sig`. Serialisasi mengikuti contoh resmi NOWPayments, yaitu `JSON.stringify(payload, Object.keys(payload).sort())`. Bentuk tersebut menyaring kunci pada seluruh tingkat, bukan hanya tingkat teratas; itu keganjilan, tetapi menyimpang darinya akan menolak setiap callback yang sah.

Pemetaan status yang perlu diperhatikan:

- `finished` adalah satu-satunya status yang membuka akses.
- `confirmed` **bukan** lunas. NOWPayments menandainya setelah konfirmasi on-chain cukup namun sebelum dana disetorkan ke merchant.
- `partially_paid` menjadi `underpaid`. Pembeli kripto lazim mengirim sedikit kurang karena biaya dompet dipotong dari nominal atau kurs bergerak antara kuotasi dan broadcast. Uangnya benar-benar masuk, sehingga pesanan bukan lunas dan bukan gagal.

Event melaporkan `price_amount`, bukan `actually_paid`. Pesanan disimpan dalam mata uang toko sedangkan `actually_paid` adalah kuantitas kripto, sehingga membandingkannya dengan total pesanan akan menolak setiap pembayaran yang sah. Kekurangan bayar dibawa oleh status, bukan oleh nominal.

NOWPayments menerima `idr` sebagai `price_currency`; hal ini diverifikasi pada 20 Agustus 2026 melalui checkout produksi, yang menampilkan kuotasi `0.00008136 BTC ~ IDR 99000`. Karena itu tidak diperlukan konversi mata uang, dan `amountsMatch` dapat membandingkan `price_amount` langsung terhadap `payment.amount` yang tersimpan dalam rupiah.

### Menambah penyedia pembayaran

`BillingGateway` menyatakan kebutuhan aplikasi, bukan kosakata satu penyedia. Callback dinormalkan menjadi `PaymentEvent` dengan `outcome` bernilai `paid`, `pending`, `underpaid`, `failed`, `expired`, `canceled`, atau `refunded`. Setiap adapter bertanggung jawab menerjemahkan status penyedianya menjadi tepat satu nilai tersebut, dan status yang tidak dikenali wajib menjadi `pending` alih-alih ditebak.

`NotificationInput` membawa payload beserta header karena penyedia berbeda tempat menaruh tanda tangan. Midtrans menandatangani body, NOWPayments memakai header.

Pemilihan penyedia berada pada `infrastructure/billing/gateway-factory.ts`, sehingga menambah penyedia tidak menyentuh berkas penyedia lain. Factory menerima nama penyedia secara eksplisit: setiap route webhook menyebut namanya sendiri, sebab callback harus diverifikasi oleh adapter yang menandatanganinya dan bukan oleh penyedia yang kebetulan sedang dipilih. Tanpa itu, mengganti `PAYMENT_PROVIDER` akan diam-diam menolak callback pesanan yang masih terbuka pada penyedia lama.

Keputusan setelah verifikasi berada di `infrastructure/billing/notification-handler.ts` dan dipakai bersama oleh seluruh route webhook, karena mencocokkan pesanan, memeriksa nominal, menyimpan status, serta membuka atau mencabut akses tepat sekali adalah urusan aplikasi, bukan urusan penyedia. Nama penyedia pada baris subscription diambil dari gateway yang memverifikasi callback; menuliskannya secara harfiah akan mencatat pembayaran kripto atas nama pemroses kartu.

Tiap adapter dipecah menjadi dua berkas. Berkas protokol memuat skema wire, tanda tangan, dan pemetaan status secara murni tanpa `server-only` sehingga dapat diuji langsung. Berkas gateway menangani jaringan dan menyimpan kunci server. Perbandingan digest dipakai bersama melalui `infrastructure/billing/signature.ts`, sebab penyedia berbeda pada apa yang ditandatangani, tidak pada cara digest diperiksa.

`underpaid` disimpan sebagai `PENDING`. Uang masuk namun tidak sesuai nominal, sehingga pesanan bukan lunas dan bukan gagal, dan menuntut keputusan tersendiri berupa refund, top-up, atau pelepasan manual.

## Satu bacaan setup untuk semua tampilan

`detectSupplyDemand` kini hanya menerima candle. Sebelumnya ia juga menerima simbol, timeframe, dan sebuah kunci per-peramban yang membekukan level setup begitu berstatus Running.

Kunci itu tinggal di `localStorage`, sehingga tabel sinyal (dihitung server) dan grafik analisis (dihitung peramban) bisa menyebut pasangan yang sama dengan arah berbeda — MET tampil di tabel Demand sementara grafiknya sendiri menyebutnya Supply Zone. Pembaca di perangkat lain melihat versi ketiga. Level yang stabil tidak sebanding dengan tiga jawaban untuk satu pertanyaan.

Yang tersisa deterministik: 300 bar terakhir masuk, satu setup keluar. `tests/zone-consistency.test.ts` menjaga tanda tangan fungsinya tetap satu argumen, supaya jawaban per-pemanggil tidak bisa muncul kembali.

Status setup bertambah satu, yaitu `Target 1 reached`. Target pertama adalah realisasi sebagian, bukan penutupan, sehingga status ini tergolong aktif dan tetap tampil di tabel.

Blok performa pada gambar ekspor mengukur dari bar yang sama dengan mesin status, dan hanya menghitung target setelah harga benar-benar menyentuh entry. Tanpa keduanya, panel bisa menulis "Limit Order" sementara blok di bawahnya mengaku sudah menyentuh Target 1.

## Wilayah eksekusi

Fungsi dijalankan di `sin1` (Singapura), dipasang lewat `regions` pada `vercel.json`.

Bawaan Vercel menempatkan fungsi di `iad1` (Washington), dan dari sana `fapi.binance.com` menjawab **HTTP 451**: Binance menutup API futures untuk alamat IP Amerika Serikat. Itulah sebab funding rate dan open interest selalu kosong, bukan karena kode pengambilnya.

Wilayah Singapura juga jauh lebih dekat ke bursa dan ke pengguna. Pemeriksaan kesehatan mencatat 601 ms ke `data-api.binance.vision` dari `iad1`; satu sapuan pemindai memanggil endpoint itu hampir dua ratus kali.

Bila latensi basis data ikut memburuk setelah perpindahan, periksa wilayah instans Postgres terlebih dahulu — bukan kembalikan wilayah fungsi, karena `iad1` membuat data futures mustahil diambil.

## Arsip hasil setup

Alert harga, riwayat setup tersimpan, watchlist, dan notifikasi in-app telah dihapus. Ketiganya menuntut pengguna merawat daftar secara manual, sementara sinyal produk ini bergerak sendiri setiap pemindaian; daftar yang harus dijaga tangan justru menua lebih cepat daripada isinya. Notifikasi ikut dilepas karena satu-satunya yang memproduksinya adalah alert dan penyelesaian setup, sehingga loncengnya tidak akan pernah berisi apa pun.

Yang tersisa pada jadwal adalah arsip bukti. Sweep memindai daftar bawaan, mengingat status setiap setup, lalu memotret dua momen: saat harga mencapai entry, dan saat setup menyentuh target kedua. Rinciannya ada pada bagian berikutnya.

Endpoint cron:

```text
GET https://DOMAIN/api/cron/setup-capture
```

Handler memerlukan header `Authorization: Bearer $CRON_SECRET`. Tanpa `CRON_SECRET` endpoint menolak seluruh permintaan dengan status 503, bukan terbuka.

Penjadwalan memakai dua sumber karena paket Vercel Hobby hanya mengizinkan satu eksekusi cron per hari:

- `vercel.json` menjadwalkan satu sweep harian sebagai jaring pengaman.
- `.github/workflows/setup-capture.yml` memanggil endpoint yang sama setiap tiga puluh menit. Interval itu menjaga penggunaan tetap berada dalam kuota GitHub Actions gratis, dan cukup rapat untuk menangkap setup pada saat ia terisi.

Workflow memerlukan dua repository secret, yaitu `PRODUCTION_URL` dan `CRON_SECRET`. Bila salah satu belum diisi, workflow berhenti bersih disertai peringatan, karena kondisi belum terkonfigurasi merupakan langkah persiapan yang belum dijalankan dan bukan kerusakan.

Setelah proyek berpindah ke Vercel Pro, workflow tersebut dapat dihapus dan jadwal dikembalikan ke `vercel.json`.

## Penangkapan bukti hasil setup

Status setup dihitung ulang pada setiap pemindaian, sehingga satu-satunya cara mengetahui adanya perubahan adalah mengingat keadaan sebelumnya. `TrackedSetup` menyimpan ingatan itu, satu baris per identitas setup.

`SetupSnapshot` menyimpan angka pembentuk gambar, bukan gambarnya. Komposisi akhir mengulang kedua snapshot di dalamnya, sehingga menyimpan SVG berarti menyimpan candle yang sama tiga kali, dan perubahan tata letak akan mengunci seluruh arsip pada desain lama. Gambar dirender saat diminta pada endpoint admin.

Setup yang pertama kali terlihat sudah terisi sengaja tidak dipotret: tidak ada gambar sebelum untuk dipasangkan, dan bukti yang disusun darinya akan menyiratkan pemindai memanggil entry lebih dulu padahal tidak. Bagian hasil diselesaikan dari candle, bukan dari pemindai, sebab setup yang sudah mencapai target kedua tidak lagi aktif dan pemindai berhenti melaporkannya.

Pemicu ENTRY berlaku untuk perpindahan dari `Limit Order` ke status terisi mana pun, bukan hanya ke `Filled`. Sweep berjalan sekitar sejam sekali terhadap grafik lima belas menit, sehingga sebuah setup umumnya sudah melewati `Filled` saat dilihat kembali. Ketika pemicunya masih menuntut status perantara itu, satu hari penuh sapuan hidup menghasilkan `entrySnapshots: 0` pada setiap larinya.

Identitas setup memakai bar pembentuk zonanya, bukan level rencananya. Stop loss ditempatkan di luar swing terkonfirmasi terakhir, sehingga ia bergeser setiap ada bar baru — zona yang sama, rencana yang dihitung ulang. Selama identitas ikut memuat level, hampir setiap sapuan mencetak baris baru: satu simbol menyimpan sebelas baris untuk satu setup, dan baris yang baru lahir tidak punya status sebelumnya untuk dibandingkan. Itulah sebab arsip tidak pernah terisi meski sweep berjalan normal.

Level pada baris `TrackedSetup` dibekukan saat pertama dibuat dan tidak diperbarui, hanya statusnya. Snapshot adalah foto dari rencana itu; membiarkan stop bergeser akan memindahkan garis finis di bawah bukti yang sudah terlanjur diambil.

Antrean penyelesaian hasil diurutkan dari yang paling lama tidak diperiksa (`resultCheckedAt`), bukan dari yang paling baru diperbarui. Setup yang sudah mencapai target justru berhenti muncul di pemindaian, sehingga urutan lama menenggelamkannya di belakang setup yang masih hidup dan tidak pernah memeriksanya lagi.

Setup yang tersentuh stop ditutup memakai aturan yang sama dengan sisa aplikasi, yaitu stop menang atas target dalam jendela yang sama. Tanpa itu, setup yang sudah tertahan lalu belakangan melintasi target akan terarsip sebagai kemenangan.

Kerugian dan setup yang terlewat tidak diarsipkan. Ini materi promosi, dan hanya setup yang mencapai target kedua yang menghasilkan bukti.

## Pembatasan endpoint mahal

`/api/scanner` dan `/api/signals` mengubah satu permintaan masuk menjadi banyak permintaan ke bursa. Dua lapis pengaman diterapkan:

1. Seluruh paket memindai daftar bawaan yang sama. Peramban tidak lagi mengirim daftar simbol sejak watchlist dihapus, sehingga satu kunci simbol dipakai bersama dan cache hasil tidak dapat dilewati dengan memvariasikan daftar.
2. Fixed-window rate limit dua puluh permintaan per menit per pengguna atau per IP, membalas `429` beserta header `Retry-After`.

Rate limit disimpan di memori proses. Pada beberapa instance, batas berlaku per instance, bukan global.

## Environment saat deploy

`vercel deploy` tidak memakai `.gitignore` untuk menyaring berkas yang diunggah. Tanpa `.vercelignore`, berkas `.env` lokal ikut terkirim ke build meskipun git mengabaikannya.

Next.js hanya mengisi variabel yang belum didefinisikan platform. Akibatnya, variabel yang absen pada project Vercel akan diam-diam mewarisi nilai dari mesin pengembang, dan nilai tersebut tidak muncul pada dashboard Vercel sehingga sulit disadari.

Hal ini pernah terjadi pada `CRON_SECRET`: endpoint produksi menerima secret yang dibuat untuk pengembangan lokal. `.vercelignore` menutup celah tersebut. Setiap variabel yang diperlukan produksi harus didefinisikan pada project Vercel, bukan mengandalkan berkas lokal.

## Sumber data pasar

Binance menjadi provider utama karena menyediakan websocket publik untuk data realtime. Bybit menjadi cadangan melalui `MarketDataPort` yang sama. Provider yang gagal dijeda selama enam puluh detik lalu dicoba kembali. Keduanya publik dan tidak memerlukan API key.

Funding rate dan open interest memakai rantai cadangannya sendiri: Binance futures, lalu Bybit, lalu OKX. Ketiganya dicoba berurutan, bukan bersamaan, sehingga pada jalur normal hanya yang pertama dipanggil. Parser tiap bursa berada di `core/domain/market/derivatives.ts` agar bentuk jawaban masing-masing dapat diuji langsung.

Sebuah sumber yang hanya menjawab separuh diperlakukan sebagai tidak menjawab. Satu angka nyata di sebelah tanda hubung terbaca sebagai "pasar tidak punya open interest", bukan sebagai "sumber ini tidak menjawab". Angka di luar rentang wajar juga ditolak, karena sumber yang mengirim persen ketika yang diharapkan pecahan terlihat lebih meyakinkan daripada sumber yang diam.

Daftar simbol disaring di `config/symbol-filters.ts`. Stablecoin, aset terbungkus, dan listing yang bukan simbol dagang dibuang di satu tempat, sebab pemindai membaca pergerakan harga sementara aset yang dipatok tidak punya pergerakan untuk dibaca — dan detektor akan tetap menemukan "zona" di dalam derau tersebut lalu memberinya skor.

## Deployment Vercel

1. Tambahkan PostgreSQL pooled connection sebagai `DATABASE_URL`.
2. Tambahkan `BETTER_AUTH_SECRET` acak minimal 32 byte.
3. Atur `BETTER_AUTH_URL` ke domain production.
4. Tambahkan environment variable penyedia pembayaran dan Brevo.
5. Tambahkan `CRON_SECRET` agar market watch dapat berjalan.
6. Jalankan `npm run db:deploy` terhadap database production.
7. Deploy aplikasi dan uji webhook Sandbox.

`postinstall` menjalankan `prisma generate`. Migration production menggunakan `prisma migrate deploy`, bukan `migrate dev`.

### Rilis

Project Vercel terhubung ke repositori GitHub, sehingga push ke `main` memicu deployment production secara otomatis. Deploy manual melalui `npx vercel --prod` tetap tersedia bila diperlukan.

Perubahan yang menyentuh schema Prisma menuntut urutan yang tidak boleh dibalik: jalankan migration terhadap database production terlebih dahulu, baru lakukan push. Kode yang meminta kolom atau tabel yang belum ada akan gagal pada halaman yang membutuhkannya.

Ambil environment production ke lokasi di luar direktori proyek saat menjalankan migration. Berkas `.env.production.local` di dalam proyek akan ikut dibaca `next build`, dan Vercel mengembalikan variabel bertanda *Sensitive* secara harfiah sebagai `[SENSITIVE]` sehingga build lokal rusak.

## Kesiapan konfigurasi

`GET /api/health` melaporkan dua hal yang terpisah. Pemeriksaan layanan eksternal bersifat publik karena tidak mengungkap apa pun yang privat. Laporan kesiapan konfigurasi hanya diberikan kepada role `ADMIN`, sebab daftar variabel yang kosong memberi tahu pembacanya alur mana yang sedang tidak terlindungi atau tidak tersedia.

Laporan menyebutkan nama variabel, tidak pernah nilainya, sehingga aman dicatat pada log. Setiap kemampuan menyatakan dampaknya bagi pengguna, bukan sekadar nama kunci yang hilang, karena kunci yang kosong tidak memunculkan galat apa pun sampai ada pengguna yang menabraknya.

Kemampuan yang dipantau: database, autentikasi, email transaksional, sweep terjadwal, dan pembayaran. Laporan pembayaran mengikuti `PAYMENT_PROVIDER`, sehingga panel menuntut kunci penyedia yang benar-benar dipakai. Penyedia yang tidak dikenali dilaporkan terhalang pada `PAYMENT_PROVIDER` itu sendiri, sebab tanpa daftar kunci untuk diperiksa sebuah salah ketik akan tampak siap sepenuhnya sementara setiap checkout membalas 503.

## Operasional

- Audit log merekam perubahan admin dan billing.
- Feature gate global berada di tabel `FeatureGate`.
- Grant per pengguna tersedia melalui `UserFeatureGrant`.
- Expired subscription diturunkan ke Free saat session berikutnya dibaca.
- Backup dan point-in-time recovery mengikuti penyedia PostgreSQL.
