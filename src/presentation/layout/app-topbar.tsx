"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Languages, Lock, LogIn, LogOut, Menu, Search, Settings, UserPlus } from "lucide-react";
import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import {
  filterSearchableSymbols,
  isValidBinanceSymbol,
  mergeSearchableSymbols,
  normalizeUsdtSymbol,
} from "@/core/domain/market/symbol";
import type { CurrentUserDto } from "@/core/domain/identity";
import { authClient, notifyAuthStateChanged } from "@/infrastructure/auth/auth-client";
import { fetchSearchableSymbols } from "@/infrastructure/market-data/symbol-catalog-client";
import { usePlan } from "@/presentation/features/access/plan-provider";
import { useT } from "@/presentation/hooks/use-translate";
import { CoinIcon } from "@/presentation/ui/coin-icon";
import { LanguageModal } from "@/presentation/ui/language-modal";

/**
 * The bar above every page: search, language, and who is signed in.
 *
 * Sticky rather than fixed, so it travels with the document scroll the new
 * shell gave back to the page.
 */
export function AppTopBar({ onOpenMobileNav }: { onOpenMobileNav?: () => void }) {
  const router = useRouter();
  const { canAccess } = usePlan();
  const { t } = useT();
  const canSearch = canAccess("symbolSearch");

  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<string[]>(DEFAULT_WATCHLIST);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [user, setUser] = useState<CurrentUserDto | null>(null);
  const [resolved, setResolved] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    void fetchSearchableSymbols()
      .then((all) => setCatalog(mergeSearchableSymbols([], all)))
      .catch(() => setCatalog(DEFAULT_WATCHLIST));
    fetch("/api/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { user?: CurrentUserDto } | null) => setUser(data?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setResolved(true));

    function onClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setSuggestOpen(false);
      }
    }
    function onShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onShortcut);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onShortcut);
    };
  }, []);

  const suggestions = suggestOpen ? filterSearchableSymbols(catalog, query) : [];
  const activeIndex = suggestions.length > 0 ? Math.min(highlight, suggestions.length - 1) : -1;

  function open(symbol: string) {
    setSuggestOpen(false);
    setQuery(symbol.replace(/USDT$/, ""));
    router.push(`/analysis?symbol=${encodeURIComponent(symbol)}`);
  }

  function submit(value = query) {
    let candidate = value.trim();
    if (!candidate) return;
    try {
      const url = new URL(candidate);
      candidate = url.searchParams.get("symbol") ?? url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    } catch {
      // A plain asset or pair, not a pasted link.
    }
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      return;
    }
    const symbol = normalizeUsdtSymbol(candidate.replace(/^.*:/, ""));
    if (!isValidBinanceSymbol(symbol)) return;
    router.push(`/analysis?symbol=${encodeURIComponent(symbol)}`);
  }

  return (
    <>
      <header className="cs-topbar sticky top-0 z-20 bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onOpenMobileNav}
            aria-label={t("nav.moreMenu")}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:text-foreground lg:hidden"
          >
            <Menu className="size-5" />
          </button>

          {canSearch ? (
            <form
              ref={searchBoxRef}
              className="relative min-w-0 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-2" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                role="combobox"
                aria-expanded={suggestions.length > 0}
                aria-controls="topbar-symbol-suggestions"
                aria-autocomplete="list"
                autoComplete="off"
                placeholder={t("search.placeholder")}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSuggestOpen(true);
                  setHighlight(0);
                }}
                onFocus={() => setSuggestOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && suggestions.length > 0) {
                    event.preventDefault();
                    setHighlight((index) => (index + 1) % suggestions.length);
                    return;
                  }
                  if (event.key === "ArrowUp" && suggestions.length > 0) {
                    event.preventDefault();
                    setHighlight((index) => (index - 1 + suggestions.length) % suggestions.length);
                    return;
                  }
                  if (event.key === "Escape") {
                    setSuggestOpen(false);
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const picked = activeIndex >= 0 ? suggestions[activeIndex] : null;
                    if (picked) open(picked);
                    else submit(event.currentTarget.value);
                  }
                }}
                className="h-11 w-full rounded-xl border border-border bg-surface pl-11 pr-4 text-[13px] text-foreground placeholder:text-muted-2 focus:border-accent-blue/60 focus:outline-none"
              />

              {suggestions.length > 0 && (
                <ul
                  id="topbar-symbol-suggestions"
                  role="listbox"
                  className="absolute left-0 top-full z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
                >
                  {suggestions.map((symbol, index) => (
                    <li key={symbol} role="option" aria-selected={index === activeIndex}>
                      <button
                        type="button"
                        // mousedown, not click: the input blurs first and the
                        // list would close before a click could land.
                        onMouseDown={(event) => {
                          event.preventDefault();
                          open(symbol);
                        }}
                        onMouseEnter={() => setHighlight(index)}
                        className={`flex w-full items-center gap-2.5 border-b border-border px-3.5 py-2.5 text-left transition-colors last:border-b-0 ${
                          index === activeIndex ? "bg-accent-blue/10" : "hover:bg-surface-2"
                        }`}
                      >
                        <CoinIcon symbol={symbol} size={24} />
                        <span className="text-[12.5px] font-bold">{symbol.replace(/USDT$/, "")}</span>
                        <span className="text-[10.5px] text-muted-2">{symbol}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </form>
          ) : (
            <Link
              href="/pricing"
              className="relative flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface pl-11 pr-3 text-[13px] text-muted-2 transition-colors hover:border-border-strong hover:text-muted"
            >
              <Search className="pointer-events-none absolute left-4 size-4 text-muted-2" />
              <span className="truncate">{t("search.locked")}</span>
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-accent-blue/40 bg-accent-blue/10 px-2 py-0.5 text-[10px] font-bold text-accent-blue">
                <Lock className="size-3" />
                {t("common.pro")}
              </span>
            </Link>
          )}

          <button
            type="button"
            onClick={() => setLanguageOpen(true)}
            aria-label={t("language.title")}
            title={t("language.title")}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            <Languages className="size-[18px]" />
          </button>

          {!resolved ? (
            <div className="h-11 w-11 shrink-0 animate-pulse rounded-xl border border-border bg-surface sm:w-44" />
          ) : user ? (
            <div className="relative shrink-0" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((value) => !value)}
                aria-expanded={menuOpen}
                aria-label={t("account.menuOpen")}
                className="flex h-11 items-center gap-2.5 rounded-xl border border-border bg-surface px-1.5 transition-colors hover:border-border-strong sm:pr-3"
              >
                <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-blue to-accent text-[11px] font-bold uppercase text-white">
                  {user.name.slice(0, 2)}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block max-w-36 truncate text-[12.5px] font-bold leading-tight">
                    {user.name}
                  </span>
                  <span className="block text-[10.5px] capitalize leading-tight text-muted-2">
                    {user.plan.toLowerCase()}
                  </span>
                </span>
                <ChevronDown className="hidden size-4 text-muted-2 sm:block" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full z-30 mt-2 w-60 rounded-2xl border border-border bg-surface-2 p-3 shadow-2xl">
                  <p className="truncate text-[12.5px] font-semibold">{user.email}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-2">
                    {user.role} · {user.plan}
                  </p>
                  <Link
                    href="/account"
                    onClick={() => setMenuOpen(false)}
                    className="mt-3 flex items-center gap-2 rounded-lg px-2 py-2 text-[12.5px] font-semibold text-muted hover:bg-surface-3 hover:text-foreground"
                  >
                    <Settings className="size-4" />
                    {t("account.settings")}
                  </Link>
                  {user.role === "ADMIN" && (
                    <Link
                      href="/admin"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 rounded-lg px-2 py-2 text-[12.5px] font-semibold text-muted hover:bg-surface-3 hover:text-foreground"
                    >
                      {t("account.adminPanel")}
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      await authClient.signOut();
                      notifyAuthStateChanged();
                      setUser(null);
                      setMenuOpen(false);
                      router.push("/");
                      router.refresh();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[12.5px] font-semibold text-negative hover:bg-negative/10"
                  >
                    <LogOut className="size-4" />
                    {t("account.signOut")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/login"
                className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-[12.5px] font-bold transition-colors hover:border-border-strong"
              >
                <LogIn className="size-4" />
                <span className="hidden sm:inline">{t("account.signIn")}</span>
              </Link>
              <Link
                href="/register"
                className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-gradient-to-r from-accent-blue to-accent px-3 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90"
              >
                <UserPlus className="size-4" />
                <span className="hidden sm:inline">{t("account.signUp")}</span>
              </Link>
            </div>
          )}
        </div>
      </header>

      <LanguageModal open={languageOpen} onClose={() => setLanguageOpen(false)} />
    </>
  );
}
