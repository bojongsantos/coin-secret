# Backend Coin Secret

## Model akses

Role dan paket tidak dicampur:

- Role `USER` memakai aplikasi biasa.
- Role `ADMIN` dapat membuka backoffice.
- Plan `FREE` melihat pratinjau tiga setup per sisi pada Dashboard; halaman Signals penuh terkunci.
- Plan `PREMIUM` melihat seluruh setup beserta fitur premium lainnya.

Hak akses fitur diputuskan dalam tiga tingkat oleh `resolveFeatureAccess`. Grant per pengguna menang mutlak, termasuk ketika bernilai menolak, karena penolakan eksplisit adalah cara memutus satu akun tanpa menyentuh akun lain. Berikutnya gate global yang membuka atau menutup fitur bagi seluruh paket tanpa rilis. Bila keduanya tidak tercatat, bawaan statis paket yang berlaku.

Premium yang masa berlakunya habis diturunkan pada permintaan berikutnya, bukan menunggu pekerjaan pembersihan. Premium tanpa periode sama sekali sengaja tidak pernah kedaluwarsa, karena itulah cara admin memberikan akses secara manual.

Admin tidak dapat menurunkan role dirinya sendiri. Tanpa aturan tersebut seorang operator dapat mengunci dirinya keluar dari backoffice dalam satu klik, sementara hanya admin yang dapat mengembalikan role itu. Menurunkan admin lain tetap diizinkan dan tidak dapat mengosongkan ruang, sebab pelakunya selalu mempertahankan rolenya sendiri.

Seluruh endpoint mutasi memeriksa session pada server. Resource per pengguna selalu difilter berdasarkan `userId` untuk mencegah IDOR. Panel admin melakukan pemeriksaan role pada layout dan setiap route API.

## Auth

Better Auth menyimpan user, credential account, session, verification token, dan rate limit di PostgreSQL. Cookie session memakai `HttpOnly`, `SameSite=Lax`, dan `Secure` pada production. Password minimal 10 karakter dan session berlaku tujuh hari.

Pendaftaran mewajibkan verifikasi email sebelum akun dapat masuk atau mengakses data aplikasi, termasuk untuk sesi lama yang belum terverifikasi. Reset password mencabut session lain. `REQUIRE_EMAIL_VERIFICATION` pada deployment lama tidak lagi mengendalikan aturan ini; verifikasi wajib dikonfigurasi langsung di Better Auth.

Origin yang boleh menggerakkan endpoint auth berasal dari `BETTER_AUTH_URL` ditambah `TRUSTED_ORIGINS` yang dipisah koma. Ini kendali CSRF, bukan daftar kemudahan: origin yang tercantum dapat mengirim permintaan sign-in dan ganti password dengan membawa cookie pengguna, sehingga daftarnya hanya disusun dari konfigurasi dan nilai yang bukan origin http(s) absolut dibuang, bukan diteruskan.

Satu origin saja cukup selama aplikasi punya satu URL. Begitu domain kedua ditambahkan, setiap sign-in dari domain yang lain gagal dengan `Invalid origin` — galat yang menyebut CSRF padahal sebabnya konfigurasi. Karena itu domain lama yang masih dilayani wajib dicantumkan pada `TRUSTED_ORIGINS`.

Di luar production, alias loopback beserta alamat LAN mesin itu sendiri ikut dipercaya, sebab `next dev` juga mengumumkan URL "Network" dan membukanya menghasilkan galat yang sama. Alamat LAN dibaca dari interface, bukan ditulis manual, karena nilainya berubah mengikuti jaringan yang sedang disambangi. Production tidak mendapat kelonggaran itu.

## Email transaksional

Pengiriman memakai Brevo melalui `BREVO_API_KEY` dan `EMAIL_FROM`. Pengirim produksi adalah `CoinSecret <noreply@coinsecret.io>` pada domain yang terautentikasi dengan record verifikasi, DKIM, dan DMARC. Nama pengirim ditetapkan di `email-service.ts` agar email verifikasi serta reset konsisten. Jangan mengembalikan pengirim ke alamat Gmail tanpa autentikasi domain karena Brevo dapat mengganti domain pengirim menjadi `brevosend.com`.

Di luar production, kunci yang kosong mencetak log alih-alih mengirim, agar alur daftar dan reset password dapat diperiksa secara lokal tanpa akun email. Pada production keadaan tersebut melempar galat, sebab tautan reset yang diam-diam tidak pernah terkirim tampak persis seperti reset yang berhasil bagi orang yang menunggunya.

Kegagalan kiriman melaporkan `code` dan `message` dari Brevo, bukan sekadar status HTTP. Pengirim yang belum diverifikasi adalah kegagalan pertama yang paling mungkin ditemui operator, dan hanya body respons yang menyebutkannya.

Berkas dipecah dua seperti adapter pembayaran: `infrastructure/email/brevo.ts` memuat bentuk payload dan pemetaan galat secara murni sehingga dapat diuji langsung, sedangkan `email-service.ts` menangani jaringan dan menyimpan kunci.

## Billing

Checkout menentukan harga pada server. Midtrans menagih IDR dari `PREMIUM_PRICE_IDR`; NOWPayments menagih katalog USD di `core/domain/billing/plans.ts`. Pilihan periode hanya menentukan paket yang dibeli, bukan nominal bebas dari browser.

Invoice pending hanya dipakai ulang bila provider, periode, nominal, dan mata uangnya sama. Mengganti periode selalu membuat checkout yang sesuai dengan pilihan baru.

`PAYMENT_PROVIDER` memilih penyedia yang menagih. Nilai yang tidak dikenali menolak melakukan penagihan alih-alih jatuh ke penyedia yang tidak diminta operator.

### Midtrans

Webhook production:

```text
https://DOMAIN/api/billing/webhook/midtrans
```

Handler memverifikasi `SHA512(order_id + status_code + gross_amount + server_key)`, nominal, mata uang, status, dan fraud status. Event settlement diproses idempotent. Pembayaran sukses menambah 30, 180, atau 365 hari sesuai periode pada order.

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

NOWPayments menerima katalog USD sebagai `price_currency`. Callback dibandingkan dengan nominal dan mata uang yang tersimpan pada order; kuantitas kripto pada `actually_paid` tidak dipakai sebagai nominal toko.

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

## Siklus hidup setup

Status dihitung oleh satu penelusuran di `core/domain/analysis/setup-lifecycle.ts`. Panel rencana, blok performa pada gambar ekspor, dan sapuan arsip membacanya bersama; sebelumnya masing-masing berjalan sendiri dan layar bisa menampilkan rencana "Limit Order" di sebelah blok yang mengaku target pertama sudah terbayar.

Tiga fase, berurutan, karena limit order tidak bisa terisi sebelum ia bisa dipasang:

1. **Terbentuk.** Candle dasar tidak dihitung sebagai pengisian. Setelah candle dasar, wick yang melewati entry searah impuls mengaktifkan limit: high di atas entry untuk long, low di bawah entry untuk short. Penutupan candle melewati entry tidak diwajibkan.
2. **Terpasang.** Limit terisi ketika harga kembali menyentuh entry pada candle berikutnya. Bila target pertama tercapai sebelum pengisian, termasuk pada candle aktivasi, setup menjadi Missed dan order dibatalkan. Sentuhan entry setelah pembatalan tidak dapat menghidupkan order kembali.
3. **Terisi.** Target dan stop berlaku.

Pada bar pengisian hanya stop yang boleh tercatat, dan bar yang menyentuh stop sekaligus target diputus sebagai kerugian. Urutan intrabar tidak diketahui, jadi aturannya sama seperti pada arsip: jangan mengklaim kemenangan yang tak terbukti, jangan menyingkirkan kerugian yang tak bisa disingkirkan.

## Setup yang sudah terbit

Pemindai memilih zona terbaik hanya ketika sebuah simbol belum membawa setup. Sesudah terbit, setup itu **dibaca ulang, bukan dipilih ulang**: levelnya beku dan hanya harga yang boleh mengubah statusnya. Simbol baru bebas membawa setup lain setelah harga menyelesaikannya — target kedua, stop, atau Missed.

Simpanannya adalah tabel `TrackedSetup` yang sama dengan arsip bukti, sehingga dasbor dan gambar hasil tidak mungkin berselisih soal level sebuah setup. Identitasnya `symbol|timeframe|direction|zoneBaseTime`; lihat [[coinsecret-setup-identity]].

Penulisan hanya terjadi saat ada setup baru atau perubahan status, jadi pasar yang tenang tidak membebani basis data sama sekali.

## Timeframe

Pemindai membaca 15m, 1H, 4H, dan 1D, lalu mengambil bacaan terbaik per simbol — confidence tertinggi, dan bila seri, timeframe yang lebih lambat karena dibangun dari lebih banyak pasar. Timeframe asal dibawa lewat tautan (`/analysis?symbol=X&tf=4H`).

Rentang histori ditentukan interval, bukan dipilih pembaca. Tiga bulan pada chart harian hanya sembilan puluh candle sedangkan deteksi membaca tiga ratus, sehingga grafik akan membaca pasar yang lebih pendek daripada tabel yang membukanya. `rangeForTimeframe` menjamin setiap interval melewati ambang itu, dan satu tes menjaganya.

Daftar di peramban menyegarkan diri tiap 60 detik, sama dengan umur cache pemindaian di server. Refresh manual melewati hasil cache yang sudah selesai, tetapi tetap bergabung dengan scan identik yang sedang berjalan. Kunci cache mencakup daftar simbol, provider, dan store setup. Kegagalan refresh tidak mengembalikan hasil cache lama sebagai data live.

Polling berhenti menambah request saat tab tersembunyi atau offline dan memuat ulang ketika tab aktif atau koneksi kembali. Kegagalan Signals ditampilkan sebagai data tidak tersedia, bukan hasil valid dengan nol setup. Market Overview boleh mempertahankan snapshot publik terakhir dengan label belum diperbarui dan waktu pembaruan terakhir. Batas sesi tetap ditegakkan server; kegagalan transport pemeriksaan sesi bukan bukti kedaluwarsa.

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

Pada Hostinger, jadwal utama memakai Cron Job Node.js hPanel setiap tiga puluh menit (menit 0 dan 30, UTC). Suffix command adalah `scripts/setup-capture-cron.mjs`; prefix Node.js dan file environment disediakan hPanel. Runner memakai `BETTER_AUTH_URL` dan `CRON_SECRET` yang sudah ada, tidak menulis token ke log, membatasi HTTP call 120 detik, dan memverifikasi JSON publication serta timestamp hasil penyimpanan. Jadwal baru dianggap aktif setelah disimpan di hPanel dan output eksekusinya diperiksa.

`.github/workflows/setup-capture.yml` menjadi cadangan pada menit 15 dan 45. Jadwal GitHub bersifat best effort dan dapat tertunda berjam-jam, sehingga tidak menjamin interval tiga puluh menit. Workflow memakai runner yang sama, dengan repository secret `PRODUCTION_URL` dan `CRON_SECRET`; konfigurasi kosong atau publication tidak terverifikasi membuat run gagal. Sweep arsip tetap dijalankan meskipun dashboard publik sering memperbarui board. `vercel.json` hanya berlaku jika aplikasi benar-benar berjalan di Vercel.

Respons cron 200 memerlukan snapshot board lengkap yang benar-benar terbaca dari penyimpanan, setidaknya sebaru scan yang selesai. Penulisan snapshot gagal atau scan parsial menghasilkan 503. Refresh yang sudah dikerjakan worker lain mengembalikan 202 `in-progress` sebelum penulisan proof, bukan mengaku telah menerbitkan board. `GET /api/cron/setup-capture?check=1` memakai autentikasi bearer yang sama dan hanya memeriksa umur snapshot tanpa mengubah setup.

Admin `GET /api/health` menampilkan waktu scan durable dan umur snapshot; di atas 45 menit ditandai overdue, di atas satu jam expired. Diagnostik ini tidak dimuat atau dikirim bagi pengunjung maupun user biasa. Entry/result capture memakai update bersyarat terhadap status yang dibaca sebelum fetch eksternal serta `archivedAt: null`; proof hanya disimpan setelah guard dalam transaksi berhasil. Worker lama tidak dapat menimpa status terbaru atau menerbitkan proof setelah archival.

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

Chart dan scanner memilih satu sumber bernama untuk satu snapshot: ticker, candle, dan timeframe lanjutan tidak dicampur antar-bursa. Batch ticker dibaca sekali per sumber, hanya ketika sumber tersebut diperlukan. Chart Bybit memakai polling berkala; streaming Binance hanya diterapkan pada histori Binance. Pemulihan koneksi mengisi semua interval candle yang terlewat sebelum evaluasi lifecycle dilanjutkan.

Setup baru menyimpan `TrackedSetup.exchange`. Setup terbit dan bukti hasilnya dibaca dari sumber tersebut; sumber yang tidak tersedia tidak diganti diam-diam. Kolom nullable sengaja mempertahankan sumber setup lama sebagai belum terverifikasi. Level dan status tersimpan tidak ditulis ulang dari tebakan sumber lain, dan UI menandai evaluasi hasil live yang ditangguhkan. Batas umur histori yang sudah ada tetap berlaku.

Pengarsipan menggunakan `TrackedSetup.archivedAt` dan `archiveReason`, terpisah dari status trading. Setup yang diarsipkan tidak lagi masuk daftar aktif, antrean capture, atau bukti hasil admin. Identitas zonanya tetap dikecualikan dari penerbitan ulang. Level, status terakhir, timestamp historis, dan snapshot tetap tersimpan; arsip tidak dihitung sebagai menang, kalah, atau missed. Pengarsipan legacy dilakukan sebagai operasi terkontrol setelah migrasi kolom dan seluruh pembaca versi baru aktif. Cache scanner berdurasi 60 detik harus kedaluwarsa sebelum hasil board diverifikasi.

Koneksi dan checkout pool PostgreSQL dibatasi 10 detik, statement server 15 detik, dan penantian lock 5 detik. Deadline scan diteruskan ke persistence untuk menghentikan write yang belum dimulai; write yang sedang berjalan ditunggu hingga selesai sebelum guard scan dilepas. Batas ini bukan jaminan seluruh request selesai dalam 40 detik. UI menghentikan skeleton ketika offline dan melanjutkan pembacaan setelah koneksi kembali.

Pembacaan mandiri setup aktif, zona selesai, dan snapshot board mencoba ulang SELECT satu kali setelah 200 ms hanya untuk kegagalan koneksi yang dikenali. Deadline menghentikan retry dan operasi yang sudah dimulai tetap ditunggu. Penulisan, transaksi, autentikasi, dan pembayaran tidak diulang. Kegagalan pembacaan akhir membalas 503; endpoint setup/signals memberi `Retry-After: 5`. Log `[database.setup-read]` hanya berisi nama operasi, kategori aman, nomor percobaan, dan keputusan retry, tanpa pesan Prisma, query, atau nilai.

Board default menyimpan hasil scan lengkap tanpa entitlement pada `AppSetting` dengan key `market.signals.default-board.v1`. Snapshot memuat versi, urutan watchlist, nama sumber, dan waktu scan asli. Sebelum dikirim, setup dicocokkan dengan identitas, sumber, level, dan status aktif database; setup archived/terminal/replaced tidak dapat muncul kembali. Akses Free/Pro dihitung ulang setiap request dan respons tetap `private, no-store`. Snapshot di bawah 60 detik dianggap segar; hasil hingga satu jam dapat ditampilkan dengan label belum diperbarui sementara `after()` menjalankan scan baru. UI memeriksa hasilnya setiap lima detik selama pembaruan berlangsung. Snapshot terlalu lama, tidak valid, atau belum ada memerlukan scan penuh yang dibatasi deadline. Refresh parsial/gagal tidak menggantikan snapshot lengkap dan dijeda 15 detik sebelum dicoba kembali. Sweep capture terjadwal yang sudah ada juga menerbitkan snapshot dari scan yang sama, tanpa scan kedua. Jadwal eksternal tetap memerlukan konfigurasi repository secret yang benar; tidak ada timer server tambahan.

Chart, Market Overview, Signals, dan Today's Top Setups tidak menampilkan waktu pembaruan terakhir atau label pembaruan rutin. Chart juga tidak menampilkan label provider di atas grafik. Kondisi gagal, offline, atau data tertunda tetap ditampilkan ketika membutuhkan perhatian; pembaruan otomatis tetap berjalan. Kegagalan membaca rencana terbit menyembunyikan level sampai verifikasi berhasil, sedangkan analisis tanpa rencana terbit diberi label belum diterbitkan. Pergantian coin membersihkan metadata timeframe lama. Jalur live tidak menghitung backtest historis yang tidak ditampilkan; aturan wick, entry, target, dan stop loss tetap memakai lifecycle domain yang sama.

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

Untuk Midtrans, kesiapan pembayaran juga menuntut `PREMIUM_PRICE_IDR`, karena katalog dolar tidak boleh dikirim sebagai nominal rupiah.

## Operasional

- Hostinger Node cron menjalankan `scripts/setup-capture-cron.mjs` setiap 30 menit sebagai jadwal utama. Konfigurasi job harus dibuat di hPanel terhadap path script deployment aktif; commit workflow saja tidak mengaktifkannya. Prefix `node --env-file` pada job memuat environment hosting yang sudah ada. Script memakai `APP_URL` atau `BETTER_AUTH_URL` dan `CRON_SECRET`, tanpa menampilkan nilainya. URL wajib HTTPS, redirect ditolak, dan request dibatasi 120 detik.
- GitHub Actions `setup-capture.yml` menjadi cadangan pada menit 15 dan 45. Scheduler GitHub bersifat best-effort dan dapat terlambat; keberhasilan job tidak menjamin interval 30 menit. Kedua scheduler memakai runner yang sama dan hanya menerima HTTP 200 ketika hasil lengkap benar-benar terbaca kembali dari snapshot durable.
- Endpoint capture mengembalikan 202 jika refresh terkoordinasi masih berlangsung dan belum membuka antrean proof. Snapshot yang gagal tersimpan, scan parsial, atau readback yang tidak membuktikan scan terbaru mengembalikan 503. Kegagalan transport/publication membuat runner keluar dengan kode 1 dan kategori log aman; tidak ada raw exception atau bearer secret di output.
- `GET /api/cron/setup-capture?check=1` memeriksa snapshot tanpa memindai atau menulis proof dan tetap mewajibkan bearer secret. Data di atas 45 menit dinyatakan overdue; di atas satu jam expired. Panel health admin membaca status durable yang sama, tanpa membuka detail tersebut kepada user biasa atau pengunjung anonim.
- Penulis proof mencocokkan status yang sebelumnya dibaca setelah pengambilan candle. Pembuatan snapshot ENTRY/RESULT berada dalam transaksi dengan update bersyarat terhadap baris yang belum diarsipkan, sehingga status yang lebih baru dan arsip konkuren tidak ditimpa.
- Audit log merekam perubahan admin dan billing.
- Feature gate global berada di tabel `FeatureGate`.
- Grant per pengguna tersedia melalui `UserFeatureGrant`.
- Expired subscription diturunkan ke Free saat session berikutnya dibaca.
- Backup dan point-in-time recovery mengikuti penyedia PostgreSQL.
