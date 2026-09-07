import type { Locale } from "@/core/domain/i18n/locale";

/**
 * Every phrase the interface says, in both languages it speaks.
 *
 * Kept as one table with the two languages side by side rather than as two
 * files. A translation that has drifted from its original is the failure mode
 * of split locale files — nobody reads them together — and here the pair is
 * literally on adjacent lines, so a wrong or missing one is visible in review
 * and provable in a test.
 *
 * Keys are namespaced by where they appear. Placeholders are written `{name}`
 * and filled by `translate`.
 */
export const MESSAGES = {
  // ------------------------------------------------------------------ common
  "common.loading": { id: "Memuat…", en: "Loading…" },
  "common.loadingLive": { id: "Memuat data live…", en: "Loading live data…" },
  "common.error": { id: "Terjadi kesalahan.", en: "Something went wrong." },
  "common.retry": { id: "Coba lagi", en: "Try again" },
  "common.close": { id: "Tutup", en: "Close" },
  "common.all": { id: "Semua", en: "All" },
  "common.free": { id: "Gratis", en: "Free" },
  "common.premium": { id: "Premium", en: "Premium" },
  "common.pro": { id: "Pro", en: "Pro" },
  "common.upgrade": { id: "Upgrade Premium", en: "Upgrade to Premium" },
  "common.notAvailable": { id: "Tidak tersedia", en: "Not available" },

  // --------------------------------------------------------------------- nav
  "nav.dashboard": { id: "Dashboard", en: "Dashboard" },
  "nav.signals": { id: "Signals", en: "Signals" },
  "nav.scanner": { id: "Scanner", en: "Scanner" },
  "nav.pricing": { id: "Pricing", en: "Pricing" },
  "nav.account": { id: "Akun", en: "Account" },
  "nav.more": { id: "Lainnya", en: "More" },
  "nav.primary": { id: "Navigasi utama", en: "Primary navigation" },
  "nav.moreMenu": { id: "Menu lainnya", en: "More menu" },
  "nav.closeMenu": { id: "Tutup menu", en: "Close menu" },
  "nav.openSidebar": { id: "Buka sidebar", en: "Open sidebar" },
  "nav.closeSidebar": { id: "Tutup sidebar", en: "Close sidebar" },
  "nav.dashboardHome": { id: "Dashboard {brand}", en: "{brand} dashboard" },

  // ------------------------------------------------------------------ search
  "search.placeholder": {
    id: "Cari coin, pair, atau tempel URL TradingView…",
    en: "Search a coin, a pair, or paste a TradingView URL…",
  },
  "search.locked": { id: "Cari coin atau pair", en: "Search a coin or pair" },
  "search.submit": { id: "Cari market", en: "Search the market" },

  // ---------------------------------------------------------------- account
  "account.menuOpen": { id: "Buka pengaturan akun", en: "Open account settings" },
  "account.settings": { id: "Pengaturan Akun", en: "Account Settings" },
  "account.adminPanel": { id: "Panel Admin", en: "Admin Panel" },
  "account.signOut": { id: "Keluar", en: "Sign out" },
  "account.signIn": { id: "Masuk", en: "Sign in" },
  "account.signUp": { id: "Daftar", en: "Sign up" },
  "account.loadingSession": { id: "Memuat sesi", en: "Loading session" },
  "account.title": { id: "Akun {brand}", en: "{brand} account" },

  // ------------------------------------------------------------------- plans
  "plan.premiumActive": {
    id: "Premium aktif. Seluruh fitur dan scanner tersedia.",
    en: "Premium is active. Every feature and the full scanner are available.",
  },
  "plan.freeActive": {
    id: "Free aktif. Tiga setup teratas per sisi terbuka untuk Anda.",
    en: "Free is active. The top three setups on each side are open to you.",
  },
  "plan.signedOut": {
    id: "Masuk untuk mengaktifkan Premium dan membuka seluruh signals.",
    en: "Sign in to activate Premium and open every signal.",
  },
  "plan.cardTitle": { id: "Paket {plan}", en: "{plan} plan" },
  // What each locked feature is, said in the reader's language. The keys match
  // `FeatureKey` so the overlay looks one up rather than carrying a copy.
  "feature.entryBreakdown": {
    id: "Level entry, target, dan invalidation",
    en: "Entry, target and invalidation levels",
  },
  "feature.convictionDetail": {
    id: "Rincian skor confidence",
    en: "The confidence score, broken down",
  },
  "feature.scannerExtended": {
    id: "Daftar peluang scanner selengkapnya",
    en: "The full list of scanner opportunities",
  },
  "feature.signals": {
    id: "Signals: setup supply dan demand langsung di seluruh papan",
    en: "Signals: live supply and demand setups across the whole board",
  },
  "feature.symbolSearch": {
    id: "Cari coin mana pun di papan",
    en: "Search any coin on the board",
  },

  // --------------------------------------------------------------- dashboard
  "dashboard.topSetups": { id: "Top 5 setup hari ini", en: "Today's top 5 setups" },
  "dashboard.scanning": { id: "Memindai…", en: "Scanning…" },
  "dashboard.noSetups": {
    id: "Belum ada setup yang lolos ambang hari ini.",
    en: "No setup has cleared today's threshold yet.",
  },
  "dashboard.noneAboveThreshold": {
    id: "Belum ada setup dengan confidence di atas {threshold}%.",
    en: "No setup is above {threshold}% confidence yet.",
  },

  // ------------------------------------------------------------------- zones
  "zones.demand": { id: "Zona Demand (Beli)", en: "Demand Zones (Buy)" },
  "zones.supply": { id: "Zona Supply (Jual)", en: "Supply Zones (Sell)" },
  "zones.scanAll": { id: "Scan Semua", en: "Scan All" },
  "zones.setupCount": { id: "{count} setup", en: "{count} setups" },
  "zones.moreSetups": { id: "{count} setup tambahan", en: "{count} more setups" },
  "zones.seeAll": { id: "Lihat semua ({count})", en: "See all ({count})" },
  "zones.pair": { id: "PAIR", en: "PAIR" },
  "zones.volume24h": { id: "VOLUME 24J", en: "24H VOLUME" },
  "zones.status": { id: "STATUS", en: "STATUS" },
  "zones.confidence": { id: "CONFIDENCE", en: "CONFIDENCE" },
  "zones.empty": { id: "Belum ada zona di sisi ini.", en: "No zone on this side yet." },
  "zones.noneAboveThreshold": {
    id: "Belum ada zona dengan confidence di atas {threshold}%.",
    en: "No zone is above {threshold}% confidence yet.",
  },

  // --------------------------------------------------------------- direction
  "direction.long": { id: "LONG", en: "LONG" },
  "direction.short": { id: "SHORT", en: "SHORT" },
  "direction.demandZone": { id: "Zona Demand", en: "Demand Zone" },
  "direction.supplyZone": { id: "Zona Supply", en: "Supply Zone" },
  "trend.bullish": { id: "bullish", en: "bullish" },
  "trend.bearish": { id: "bearish", en: "bearish" },
  "trend.neutral": { id: "netral", en: "neutral" },
  "level.Entry": { id: "Entry", en: "Entry" },
  "level.Target 1": { id: "Target 1", en: "Target 1" },
  "level.Target 2": { id: "Target 2", en: "Target 2" },
  "level.Invalidation (SL)": { id: "Invalidation (SL)", en: "Invalidation (SL)" },
  "pattern.Demand Zone": { id: "Zona Demand", en: "Demand Zone" },
  "pattern.Supply Zone": { id: "Zona Supply", en: "Supply Zone" },
  "pattern.No Zone Setup": { id: "Belum Ada Setup Zona", en: "No Zone Setup" },

  // ------------------------------------------------------------------ status
  "status.Limit Order": { id: "Limit Order", en: "Limit Order" },
  "status.Filled": { id: "Terisi", en: "Filled" },
  "status.Running": { id: "Berjalan", en: "Running" },
  "status.Target 1 reached": { id: "Target 1 tercapai", en: "Target 1 reached" },
  "status.Target 2 reached": { id: "Target 2 tercapai", en: "Target 2 reached" },
  "status.Invalidated (SL hit)": { id: "Batal (SL kena)", en: "Invalidated (SL hit)" },
  "status.Missed": { id: "Terlewat", en: "Missed" },

  // -------------------------------------------------------------------- plan
  "plan.tradingPlan": { id: "Rencana Trading", en: "Trading Plan" },
  "plan.confidence": { id: "CONFIDENCE", en: "CONFIDENCE" },
  "plan.riskLevel": { id: "TINGKAT RISIKO", en: "RISK LEVEL" },
  "plan.breakdown": { id: "RINCIAN TRADE", en: "TRADE BREAKDOWN" },
  "plan.entry": { id: "Entry", en: "Entry" },
  "plan.target1": { id: "Target 1", en: "Target 1" },
  "plan.target2": { id: "Target 2", en: "Target 2" },
  "plan.stopLoss": { id: "Invalidation (SL)", en: "Invalidation (SL)" },
  "plan.riskReward": { id: "Rasio Risk-Reward", en: "Risk-Reward Ratio" },
  "plan.noSetup": { id: "Belum Ada Setup Zona", en: "No Zone Setup" },
  "plan.noSetupHint": {
    id: "Belum ada zona yang memenuhi syarat pada interval ini.",
    en: "No zone meets the conditions on this interval yet.",
  },
  "plan.reasoning": { id: "Analisis Teknikal & Alasan", en: "Technical Analysis & Reasoning" },

  // ------------------------------------------------------------------- risk
  "risk.low": { id: "rendah", en: "low" },
  "risk.medium": { id: "sedang", en: "medium" },
  "risk.high": { id: "tinggi", en: "high" },

  // ------------------------------------------------------------------- chart
  "chart.analyzedAt": { id: "Dianalisis {date}", en: "Analyzed {date}" },
  "chart.download": { id: "Unduh", en: "Download" },
  "chart.live": { id: "LIVE", en: "LIVE" },
  "chart.offline": { id: "OFFLINE", en: "OFFLINE" },
  "chart.loadMore": { id: "Muat riwayat lebih lama", en: "Load older history" },
  "chart.downloadTitle": {
    id: "Unduh chart dan rencana trading sebagai gambar",
    en: "Download the chart and its trading plan as an image",
  },
  "chart.downloadWorking": { id: "Menyiapkan…", en: "Preparing…" },
  "chart.downloadDone": { id: "Tersimpan", en: "Saved" },
  "chart.downloadFailed": { id: "Gagal", en: "Failed" },
  "chart.imageFailed": { id: "Gambar gagal dibuat.", en: "The image could not be produced." },

  // ----------------------------------------------------------------- pricing
  "pricing.headline": {
    id: "Mulai baca pasar dengan aturan, bukan tebakan",
    en: "Read the market by rule, not by guess",
  },
  "pricing.subhead": {
    id: "Satu paket berbayar, tanpa tingkatan tersembunyi. Seluruh analisis dihasilkan dari aturan teknikal terprogram, dan Coin Secret tidak mengeksekusi transaksi.",
    en: "One paid plan, with no hidden tiers. Every analysis comes from programmed technical rules, and Coin Secret never places a trade.",
  },
  "pricing.periodGroup": { id: "Periode langganan", en: "Billing period" },
  "pricing.period.monthly": { id: "Bulanan", en: "Monthly" },
  "pricing.period.sixMonth": { id: "6 Bulan", en: "6 Months" },
  "pricing.period.annual": { id: "Tahunan", en: "Annual" },
  "pricing.savings": { id: "Hemat {percent}%", en: "Save {percent}%" },
  "pricing.freeBlurb": {
    id: "Untuk mengenal cara kerja zona dan setup.",
    en: "To learn how zones and setups work.",
  },
  "pricing.forever": { id: "Selamanya", en: "Forever" },
  "pricing.currentPlan": { id: "Paket Anda saat ini", en: "Your current plan" },
  "pricing.includedInPro": { id: "Termasuk dalam Pro", en: "Included in Pro" },
  "pricing.registerFree": { id: "Daftar gratis", en: "Sign up free" },
  "pricing.popular": { id: "Populer", en: "Popular" },
  "pricing.proBlurb": {
    id: "Seluruh coin dan seluruh trading plan.",
    en: "Every coin and every trading plan.",
  },
  "pricing.perMonth": { id: "/ bulan", en: "/ month" },
  "pricing.billedMonthly": { id: "Ditagih {total} tiap bulan", en: "Billed {total} every month" },
  "pricing.billedOnce": {
    id: "Ditagih {total} sekali untuk {months} bulan",
    en: "Billed {total} once for {months} months",
  },
  "pricing.noAutoRenew": { id: "tanpa perpanjangan otomatis", en: "no automatic renewal" },
  "pricing.signInToSubscribe": { id: "Masuk untuk berlangganan", en: "Sign in to subscribe" },
  "pricing.proActive": { id: "Pro aktif", en: "Pro is active" },
  "pricing.activeUntil": { id: "Berlaku sampai {date}", en: "Active until {date}" },
  "pricing.payVia": { id: "Bayar {total} melalui {provider}", en: "Pay {total} via {provider}" },
  "pricing.checkoutFailed": {
    id: "Checkout tidak dapat dibuat.",
    en: "The checkout could not be created.",
  },
  "pricing.checkoutOffline": {
    id: "Checkout tidak dapat dibuat. Periksa koneksi Anda.",
    en: "The checkout could not be created. Check your connection.",
  },
  "pricing.included": { id: "Termasuk", en: "Included" },
  "pricing.notIncluded": { id: "Tidak termasuk", en: "Not included" },
  "pricing.comparison": { id: "Perbandingan lengkap", en: "Full comparison" },
  "pricing.capabilityColumn": { id: "Kemampuan", en: "Capability" },
  "pricing.beforeYouPay": {
    id: "Yang perlu Anda ketahui sebelum membayar",
    en: "What to know before you pay",
  },
  "pricing.noteUpfront": {
    id: "Pro dibayar sekali di muka untuk periode yang Anda pilih dan **tidak** diperpanjang otomatis. Tidak ada tagihan berulang.",
    en: "Pro is paid once up front for the period you choose and does **not** renew automatically. There is no recurring charge.",
  },
  "pricing.noteExpiry": {
    id: "Setelah masa aktif berakhir, akun kembali ke Free. Riwayat pembayaran dan data akun Anda tetap tersimpan.",
    en: "When the period ends the account returns to Free. Your payment history and account data are kept.",
  },
  "pricing.noteDisclaimer": {
    id: "Coin Secret adalah alat analisis teknikal berbasis aturan. Ia tidak memberi nasihat investasi dan tidak menjanjikan hasil.",
    en: "Coin Secret is a rule-based technical analysis tool. It gives no investment advice and promises no outcome.",
  },

  // ------------------------------------------------------------ capabilities
  "capability.coins": { id: "Coin dan token", en: "Coins and tokens" },
  "capability.tradingPlan": { id: "Rencana trading", en: "Trading plan" },
  "capability.reasoning": {
    id: "Analisis teknikal & alasan",
    en: "Technical analysis & reasoning",
  },
  "capability.confidence": { id: "Skor confidence", en: "Confidence score" },
  "capability.marketContext": { id: "Konteks pasar", en: "Market context" },
  "capability.marketSentiment": { id: "Sentimen pasar", en: "Market sentiment" },
  "capability.limited": { id: "Terbatas", en: "Limited" },
  "capability.full": { id: "Akses penuh", en: "Full access" },

  // ----------------------------------------------------------------- signals
  "signals.locked": { id: "Signals terkunci", en: "Signals are locked" },
  "signals.lockedBody": {
    id: "Signals lengkap tersedia pada paket Premium.",
    en: "The full signals board comes with Premium.",
  },
  "signals.lockedHint": {
    id: "Upgrade melalui halaman Akun & Billing.",
    en: "Upgrade from the Account & Billing page.",
  },

  // -------------------------------------------------------------------- auth
  "auth.signInTitle": { id: "Masuk ke akun", en: "Sign in to your account" },
  "auth.signUpTitle": { id: "Buat akun baru", en: "Create an account" },
  "auth.signInBlurb": {
    id: "Lanjutkan ke dashboard Coin Secret.",
    en: "Carry on to the Coin Secret dashboard.",
  },
  "auth.signUpBlurb": {
    id: "Paket Free aktif setelah registrasi.",
    en: "The Free plan is active as soon as you register.",
  },
  "auth.name": { id: "Nama", en: "Name" },
  "auth.email": { id: "Email", en: "Email" },
  "auth.password": { id: "Password", en: "Password" },
  "auth.forgotPassword": { id: "Lupa password?", en: "Forgotten your password?" },
  "auth.noAccount": { id: "Belum memiliki akun?", en: "No account yet?" },
  "auth.haveAccount": { id: "Sudah memiliki akun?", en: "Already have an account?" },
  "auth.failed": { id: "Autentikasi gagal.", en: "Authentication failed." },

  // ----------------------------------------------------------------- billing
  "billing.title": { id: "Akun & Billing", en: "Account & Billing" },
  "billing.subtitle": {
    id: "Kelola identitas dan paket Coin Secret.",
    en: "Manage your Coin Secret identity and plan.",
  },
  "billing.profile": { id: "Profil", en: "Profile" },
  "billing.role": { id: "Role", en: "Role" },
  "billing.plan": { id: "Paket", en: "Plan" },
  "billing.verified": { id: "Terverifikasi", en: "Verified" },
  "billing.unverified": { id: "Belum terverifikasi", en: "Not verified" },
  "billing.changePassword": { id: "Ubah Password", en: "Change Password" },
  "billing.currentPassword": { id: "Password saat ini", en: "Current password" },
  "billing.newPassword": { id: "Password baru", en: "New password" },
  "billing.savePassword": { id: "Simpan password", en: "Save password" },
  "billing.passwordChanged": { id: "Password berhasil diubah.", en: "Your password was changed." },
  "billing.passwordFailed": { id: "Password gagal diubah.", en: "The password could not be changed." },
  "billing.proPitch": {
    id: "Seluruh coin dan seluruh trading plan, tanpa batas pencarian.",
    en: "Every coin and every trading plan, with no search limit.",
  },
  "billing.perMonthAnnual": {
    id: "/ bulan pada paket tahunan",
    en: "/ month on the annual plan",
  },
  "billing.proActive": { id: "Pro aktif.", en: "Pro is active." },
  "billing.seePlans": { id: "Lihat paket", en: "See the plans" },
  "billing.history": { id: "Riwayat Pembayaran", en: "Payment History" },
  "billing.noPayments": { id: "Belum ada pembayaran.", en: "No payments yet." },

  // ---------------------------------------------------------- market context
  // Each explanation states the measurement first and what a move in it
  // implies second, so a reader can stop after one sentence and still be
  // better off.
  "metric.dom": {
    id: "Bagian dari total kapitalisasi pasar kripto yang dipegang Bitcoin. Ketika angkanya naik, modal cenderung berpindah dari altcoin ke Bitcoin.",
    en: "Bitcoin's share of the whole crypto market capitalisation. When it rises, money tends to be moving out of altcoins and into Bitcoin.",
  },
  "metric.funding": {
    id: "Biaya berkala yang dibayarkan antar pemegang posisi perpetual. Nilai positif berarti posisi beli membayar posisi jual, tanda pasar sedang condong ke arah beli.",
    en: "The periodic fee perpetual holders pay each other. A positive value means longs are paying shorts, which says the market is leaning long.",
  },
  "metric.oi": {
    id: "Nilai seluruh posisi futures yang masih terbuka. Kenaikan yang searah dengan harga menunjukkan tren ditopang modal baru, bukan sekadar penutupan posisi lama.",
    en: "The value of every futures position still open. Rising alongside price means the move is carried by new money rather than by positions being closed.",
  },
  "metric.fng": {
    id: "Indeks sentimen pasar berskala 0 sampai 100 dari Alternative.me. Angka rendah menandakan pasar cenderung takut, angka tinggi menandakan pasar cenderung serakah.",
    en: "A 0-to-100 market sentiment index from Alternative.me. Low readings say the market is fearful, high ones that it is greedy.",
  },
  "metric.unavailableNote": {
    id: "Sumber datanya sedang tidak dapat dijangkau.",
    en: "Its data source cannot be reached right now.",
  },
  "metric.unavailable": { id: "Data tidak tersedia", en: "Data unavailable" },
  "rail.marketContext": { id: "Konteks Pasar", en: "Market Context" },
  "rail.marketSentiment": { id: "Sentimen Pasar", en: "Market Sentiment" },
  "rail.convictionScore": { id: "Skor Keyakinan", en: "Conviction Score" },
  "rail.confidenceScore": { id: "Skor Confidence", en: "Confidence Score" },
  "rail.waitingForData": { id: "Menunggu data live", en: "Waiting for live data" },
  "conviction.quality": {
    id: "Rasio kerapatan zona terhadap volatilitas pasar. Semakin sempit, semakin akurat sebagai level entry.",
    en: "How tight the zone is against the market's volatility. The narrower it is, the sharper it works as an entry level.",
  },
  "conviction.freshness": {
    id: "Status integritas zona. Fresh: belum diuji. Tested: sudah retested. Broken: harga telah menembus.",
    en: "Whether the zone is still intact. Fresh: never tested. Tested: revisited. Broken: price has gone through it.",
  },
  "conviction.touches": {
    id: "Pengurangan skor akibat retest zona. Setiap sentuhan mengurangi 5 poin.",
    en: "What retests take off the score. Each touch costs 5 points.",
  },
  "conviction.base": {
    id: "Skor dasar yang diberikan pada setiap zona yang berhasil terdeteksi dan tervalidasi.",
    en: "The starting score every detected and validated zone is given.",
  },

  // ------------------------------------------------------------ error states
  "error.pageFailed": { id: "Halaman tidak dapat dimuat.", en: "This page could not load." },
  "error.pageFailedBody": {
    id: "Gangguan dapat berasal dari koneksi atau layanan data pasar.",
    en: "The trouble may be your connection or the market data service.",
  },
  "error.reference": { id: "Referensi: {digest}", en: "Reference: {digest}" },
  "error.notFound": { id: "Halaman tidak ditemukan.", en: "Page not found." },
  "error.notFoundBody": {
    id: "Alamat tidak tersedia pada Coin Secret.",
    en: "There is nothing at this address on Coin Secret.",
  },
  "error.backHome": { id: "Kembali ke dashboard", en: "Back to the dashboard" },
  "loading.app": { id: "Memuat Coin Secret…", en: "Loading Coin Secret…" },

  // ---------------------------------------------------------------- recovery
  "recovery.forgotTitle": { id: "Lupa password", en: "Forgotten password" },
  "recovery.resetTitle": { id: "Atur password baru", en: "Set a new password" },
  "recovery.forgotBlurb": {
    id: "Kami akan mengirim tautan reset ke email terdaftar.",
    en: "We will send a reset link to the registered address.",
  },
  "recovery.resetBlurb": { id: "Gunakan minimal 10 karakter.", en: "Use at least 10 characters." },
  "recovery.requestFailed": { id: "Permintaan gagal.", en: "The request failed." },
  "recovery.linkSent": {
    id: "Jika akun tersedia, tautan reset telah dikirim.",
    en: "If an account exists, a reset link has been sent.",
  },
  "recovery.badToken": { id: "Token reset tidak valid.", en: "That reset token is not valid." },
  "recovery.sendLink": { id: "Kirim tautan reset", en: "Send the reset link" },
  "recovery.backToLogin": { id: "Kembali ke login", en: "Back to sign in" },
  "recovery.redirecting": {
    id: "Mengalihkan ke halaman login dalam {seconds} detik…",
    en: "Taking you to sign in in {seconds} seconds…",
  },

  // ------------------------------------------------------------------- chart
  "chart.loadLimit": {
    id: "Batas pemuatan tercapai. Geser ke kiri untuk menambah.",
    en: "The load limit is reached. Scroll left to fetch more.",
  },

  // ------------------------------------------------------------------ admin
  "admin.gatingBlurb": {
    id: "Aturan akses global per paket dari database.",
    en: "Global per-plan access rules, read from the database.",
  },
  "admin.healthBlurb": {
    id: "Status seluruh layanan eksternal Coin Secret.",
    en: "The state of every external service Coin Secret depends on.",
  },
  "admin.recheck": { id: "Cek Ulang", en: "Re-check" },
  "admin.summary": { id: "Ringkasan", en: "Summary" },
  "admin.configReadiness": { id: "Kesiapan konfigurasi", en: "Configuration readiness" },
  "admin.ready": { id: "Siap", en: "Ready" },
  "admin.halted": { id: "Terhenti", en: "Halted" },
  "admin.overviewBlurb": { id: "Data langsung dari PostgreSQL.", en: "Read live from PostgreSQL." },
  "admin.allStatuses": { id: "Semua status", en: "All statuses" },
  "admin.paymentsBlurb": {
    id: "Status pembayaran berasal dari webhook penyedia pembayaran.",
    en: "Payment status comes from the payment provider's webhook.",
  },
  "admin.scanNow": { id: "Scan Sekarang", en: "Scan Now" },
  "admin.resultsFailed": { id: "Gagal memuat hasil.", en: "The results could not be loaded." },
  "admin.usersBlurb": {
    id: "Role dan paket dikelola terpisah.",
    en: "Role and plan are managed separately.",
  },
  "admin.direction": { id: "Arah", en: "Direction" },
  "analysis.searchSymbol": { id: "Cari simbol…", en: "Search a symbol…" },
  "admin.image": { id: "Gambar", en: "Image" },
  "admin.finished": { id: "Selesai", en: "Finished" },

  // ----------------------------------------------------------------- landing
  "landing.home": { id: "Beranda Coin Secret", en: "Coin Secret home" },
  "landing.launchApp": { id: "Buka Aplikasi", en: "Launch App" },
  "landing.howItWorks": { id: "Cara kerjanya", en: "How it works" },
  "landing.nav.about": { id: "Tentang", en: "About" },
  "landing.nav.technologies": { id: "Teknologi", en: "Technologies" },
  "landing.nav.products": { id: "Produk", en: "Products" },
  "landing.nav.buyPremium": { id: "Beli Premium", en: "Buy Premium" },
  "landing.eyebrow": { id: "Coin Secret", en: "Coin Secret" },
  "landing.headline": {
    id: "Zona supply dan demand di {pairs} pair, dibaca aturan yang sama setiap kali",
    en: "Supply and demand zones on {pairs} pairs, read by the same rules every time",
  },
  "landing.subhead": {
    id: "Coin Secret memindai pasar kripto dengan aturan teknikal yang tetap, bukan model yang menebak. Tiap setup datang lengkap dengan entry, dua target, dan level yang membatalkannya — beserta alasan yang bisa kamu periksa sendiri.",
    en: "Coin Secret scans the crypto market with fixed technical rules, not a model that guesses. Every setup arrives with an entry, two targets and the level that voids it — and the reasoning is there for you to check.",
  },
  "landing.disclaimer": {
    id: "Not Financial Advice · DYOR · analisis teknikal berbasis aturan, bukan nasihat investasi",
    en: "Not Financial Advice · DYOR · rule-based technical analysis, not investment advice",
  },

  "landing.about.title": {
    id: "Rencana yang diberikan tidak berubah di tengah jalan",
    en: "A plan you are given does not change halfway through",
  },
  "landing.about.p1.title": { id: "Zona dulu, baru rencana", en: "The zone first, then the plan" },
  "landing.about.p1.body": {
    id: "Aturannya mencari jejak ketidakseimbangan — bar yang meninggalkan sebuah harga dengan cepat — lalu mengukur zonanya. Entry, dua target, dan stop diturunkan dari zona itu, bukan dipilih belakangan.",
    en: "The rules look for where price left a level in a hurry, then measure the zone it left behind. The entry, both targets and the stop all come from that zone rather than being picked afterwards.",
  },
  "landing.about.p2.title": { id: "Terbit sekali, dipegang", en: "Published once, then held" },
  "landing.about.p2.body": {
    id: "Setelah sebuah setup ditampilkan, levelnya tidak dihitung ulang. Detektor boleh melihat zona lain menit berikutnya; yang sudah kamu baca tetap seperti saat kamu membacanya.",
    en: "Once a setup is shown, its levels are never recomputed. The detector may see a different zone a minute later; the one you were handed stays as it was.",
  },
  "landing.about.p3.title": { id: "Diikuti sampai selesai", en: "Followed to the end" },
  "landing.about.p3.body": {
    id: "Statusnya berjalan berurutan: menunggu, terisi, target, atau batal. Yang sudah selesai tidak muncul lagi sebagai peluang baru.",
    en: "Its status walks in order: waiting, filled, target, or void. What has finished does not come back as a fresh opportunity.",
  },

  "landing.tech.title": {
    id: "Tidak ada model yang menebak di baliknya",
    en: "There is no guessing model behind it",
  },
  "landing.tech.rules": { id: "Berbasis aturan, bukan AI", en: "Rule-based, not AI" },
  "landing.tech.rulesBody": {
    id: "Setiap angka di layar bisa ditelusuri ke aturan yang menghasilkannya. Masukan yang sama selalu memberi keluaran yang sama, dan itulah alasan hasilnya bisa diuji.",
    en: "Every number on screen traces back to the rule that produced it. The same input always gives the same output, which is what makes the results testable at all.",
  },
  "landing.tech.data": { id: "Data langsung dari bursa", en: "Exchange data, first hand" },
  "landing.tech.dataBody": {
    id: "Harga, candle, funding rate, dan open interest diambil langsung dari bursa — {pairs} pair pada interval 15 menit dan 1 jam.",
    en: "Prices, candles, funding rate and open interest come straight from the exchange — {pairs} pairs on the fifteen-minute and hourly charts.",
  },
  "landing.tech.lifecycle": { id: "Siklus setup tiga fase", en: "A three-phase setup lifecycle" },
  "landing.tech.lifecycleBody": {
    id: "Tidak ada yang dihitung sampai harga benar-benar menutup melewati entry, lalu kembali menyentuhnya. Order limit yang langsung tereksekusi bukan setup.",
    en: "Nothing counts until price closes clear of the entry and comes back to touch it. A limit order that would fill the instant it is placed is not a setup.",
  },
  "landing.tech.archive": { id: "Hasilnya diarsipkan", en: "Outcomes are archived" },
  "landing.tech.archiveBody": {
    id: "Setup yang mencapai target kedua difoto: keadaan saat entry dan hasil akhirnya, pada skala waktu dan harga yang sama.",
    en: "A setup that reaches its second target is photographed: how it looked at entry and how it ended, on one shared time and price scale.",
  },

  "landing.products.title": { id: "Yang bisa kamu buka hari ini", en: "What you can open today" },
  "landing.products.board": { id: "Papan Signals", en: "The Signals board" },
  "landing.products.boardBody": {
    id: "Zona demand dan supply yang sedang hidup, beserta status dan confidence-nya, di seluruh papan.",
    en: "Live demand and supply zones across the whole board, each with its status and confidence.",
  },
  "landing.products.plan": { id: "Rencana trading", en: "The trading plan" },
  "landing.products.planBody": {
    id: "Entry, dua target, level pembatalan, dan rasio risk-reward — digambar pada chart tempat rencananya diukur.",
    en: "Entry, two targets, the invalidation level and the risk-reward ratio — drawn on the chart the plan was measured on.",
  },
  "landing.products.reasoning": { id: "Analisis & alasan", en: "Analysis and reasoning" },
  "landing.products.reasoningBody": {
    id: "Struktur pasar, level kunci, momentum, dan manajemen risiko yang dihitung dari angka setup itu sendiri.",
    en: "Market structure, key levels, momentum and risk management, worked out from that setup's own numbers.",
  },
  "landing.products.scanner": { id: "Market Scanner", en: "The market scanner" },
  "landing.products.scannerBody": {
    id: "Sapuan menyeluruh atas {pairs} pair, diurutkan supaya yang paling layak dilihat berada di atas.",
    en: "A sweep across all {pairs} pairs, ranked so the ones worth a look sit at the top.",
  },

  "landing.pricing.title": {
    id: "Satu paket berbayar, dibayar di muka",
    en: "One paid plan, paid up front",
  },
  "landing.pricing.body": {
    id: "Tidak ada tingkatan tersembunyi dan tidak ada perpanjangan otomatis. Yang dijual adalah jangkauan — seluruh coin dan seluruh rencana — bukan kedalaman analisisnya.",
    en: "No hidden tiers and no automatic renewal. What is sold is reach — every coin and every plan — not the depth of the analysis.",
  },
  "landing.pricing.buy": { id: "Ambil Pro — {total}", en: "Get Pro — {total}" },
  "landing.pricing.note": {
    id: "Pembayaran diproses di halaman akun karena butuh akun. Setelah masa aktif berakhir, akun kembali ke Free dan riwayat pembayarannya tetap tersimpan.",
    en: "Payment is handled on the account page because it needs an account. When the period ends the account returns to Free, and its payment history is kept.",
  },

  "landing.cta.title": { id: "Lihat papannya sekarang", en: "Open the board now" },
  "landing.cta.body": {
    id: "Tidak perlu akun untuk melihat. Paket Free membuka tiga setup teratas di tiap sisi beserta seluruh analisisnya.",
    en: "No account needed to look. The Free plan opens the top three setups on each side, with the full analysis.",
  },

  // ---------------------------------------------------------------- language
  "language.switchTo": { id: "Switch to English", en: "Ganti ke Bahasa Indonesia" },
  "language.current": { id: "ID", en: "EN" },
} as const satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof MESSAGES;

/**
 * The message for a setup status, or null when the status is one this table
 * does not know.
 *
 * Statuses are domain values that also happen to be English sentences, so an
 * unknown one still reads acceptably on the page. Falling back to it beats
 * printing a raw key.
 */
/**
 * The message for a value the analysis engine produced — a pattern name, a
 * level label, a trend — or null when this table does not carry it.
 *
 * The engine speaks in stable English domain values rather than in the
 * reader's language, so the translation happens here, at the edge, and the
 * numbers those values sit beside are never touched.
 */
export function domainMessageKey(namespace: string, value: string | undefined | null): MessageKey | null {
  if (!value) return null;
  const key = `${namespace}.${value}`;
  return key in MESSAGES ? (key as MessageKey) : null;
}

export function statusMessageKey(status: string | undefined | null): MessageKey | null {
  if (!status) return null;
  const key = `status.${status}`;
  return key in MESSAGES ? (key as MessageKey) : null;
}

/**
 * One phrase in one language, with `{placeholders}` filled in.
 *
 * An unknown key returns the key itself rather than throwing: a missing
 * translation should look wrong on the page, not take the page down.
 */
export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const entry = MESSAGES[key] as Record<Locale, string> | undefined;
  if (!entry) return key;
  const text = entry[locale] ?? entry.id;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
