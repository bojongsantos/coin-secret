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
