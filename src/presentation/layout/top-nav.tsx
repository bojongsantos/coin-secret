"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Lock, Search, LogIn, LogOut, Settings, UserPlus } from "lucide-react";
import { BrandMark, BRAND_NAME } from "@/presentation/ui/brand-logo";
import { ThemeToggle } from "@/presentation/ui/theme-toggle";
import {
  filterSearchableSymbols,
  isValidBinanceSymbol,
  mergeSearchableSymbols,
  normalizeUsdtSymbol,
} from "@/core/domain/market/symbol";
import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import { fetchSearchableSymbols } from "@/infrastructure/market-data/symbol-catalog-client";
import { CoinIcon } from "@/presentation/ui/coin-icon";
import { usePlan } from "@/presentation/features/access/plan-provider";
import { authClient, notifyAuthStateChanged } from "@/infrastructure/auth/auth-client";
import type { CurrentUserDto } from "@/core/domain/identity";

export function TopNav() {
  const router = useRouter();
  // Reaching any coin on the board is what Pro sells. A free reader works from
  // the setups the product puts in front of them.
  const { canAccess } = usePlan();
  const canSearch = canAccess("symbolSearch");
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentUser, setCurrentUser] = useState<CurrentUserDto | null>(null);
  const [userResolved, setUserResolved] = useState(false);
  const [catalog, setCatalog] = useState<string[]>(DEFAULT_WATCHLIST);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    void fetchSearchableSymbols()
      .then((all) => setCatalog(mergeSearchableSymbols([], all)))
      .catch(() => setCatalog(DEFAULT_WATCHLIST));
    fetch("/api/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { user?: CurrentUserDto } | null) => setCurrentUser(data?.user ?? null))
      .catch(() => setCurrentUser(null))
      .finally(() => setUserResolved(true));
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    }
    function onShortcut(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
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

  const suggestions = suggestOpen ? filterSearchableSymbols(catalog, searchQuery) : [];
  const activeIndex = suggestions.length > 0 ? Math.min(highlight, suggestions.length - 1) : -1;

  function goToSymbol(symbol: string) {
    setSuggestOpen(false);
    setSearchQuery(symbol.replace(/USDT$/, ""));
    router.push(`/analysis?symbol=${encodeURIComponent(symbol)}`);
  }

  function submitSearch(value = searchQuery) {
    let candidate = value.trim();
    if (!candidate) return;
    try {
      const url = new URL(candidate);
      candidate = url.searchParams.get("symbol") ?? url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    } catch {
      // Plain asset or pair input.
    }
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      return;
    }
    candidate = candidate.replace(/^.*:/, "");
    const symbol = normalizeUsdtSymbol(candidate);
    if (!isValidBinanceSymbol(symbol)) return;
    router.push(`/analysis?symbol=${encodeURIComponent(symbol)}`);
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:gap-4 sm:px-6">
      <Link href="/" className="flex h-9 shrink-0 items-center lg:hidden" aria-label={`${BRAND_NAME} dashboard`}>
        <BrandMark size={26} />
      </Link>
      {canSearch ? (
        <form
          ref={searchBoxRef}
          className="relative hidden w-full max-w-xl md:block"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch();
          }}
        >
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-2" />
          <input
            ref={searchRef}
            type="search"
            value={searchQuery}
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="symbol-suggestions"
            aria-autocomplete="list"
            autoComplete="off"
            onChange={(event) => {
              setSearchQuery(event.target.value);
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
                // A highlighted suggestion wins over the raw text: it is what the
                // reader can see, and typing "eth" alone would otherwise resolve
                // through the pair parser instead of the list they are looking at.
                const picked = activeIndex >= 0 ? suggestions[activeIndex] : null;
                if (picked) goToSymbol(picked);
                else submitSearch(event.currentTarget.value);
              }
            }}
            placeholder="Cari coin, pair, atau tempel URL TradingView…"
            className="w-full rounded-lg border border-border bg-background py-2 pl-10 pr-14 text-[13px] text-foreground placeholder:text-muted-2 focus:border-accent/50 focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Cari market"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-muted-2 hover:text-foreground"
          >
            ↵
          </button>

          {suggestions.length > 0 && (
            <ul
              id="symbol-suggestions"
              role="listbox"
              className="absolute left-0 top-full z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
            >
              {suggestions.map((symbol, index) => (
                <li key={symbol} role="option" aria-selected={index === activeIndex}>
                  <button
                    type="button"
                    // mousedown, not click: the input blurs first and would close
                    // the list before a click ever lands on it.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      goToSymbol(symbol);
                    }}
                    onMouseEnter={() => setHighlight(index)}
                    className={`flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 ${
                      index === activeIndex ? "bg-accent/10" : "hover:bg-surface-2"
                    }`}
                  >
                    <CoinIcon symbol={symbol} size={24} />
                    <span className="text-[12px] font-bold">{symbol.replace(/USDT$/, "")}</span>
                    <span className="text-[10px] text-muted-2">{symbol}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      ) : (
        /* Not blurred behind an overlay: a search box that looks usable and
           silently is not wastes the reader's time. It says what it is and
           where to get it. */
        <Link
          href="/pricing"
          className="relative hidden w-full max-w-xl items-center gap-2 rounded-lg border border-border bg-background py-2 pl-10 pr-3 text-[13px] text-muted-2 transition-colors hover:border-border-strong hover:text-muted md:flex"
        >
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-2" />
          <span className="truncate">Cari coin atau pair</span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent-2">
            <Lock className="size-3" />
            Pro
          </span>
        </Link>
      )}

      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle />

        {!userResolved ? (
          <div className="h-9 w-28 animate-pulse rounded-lg border border-border bg-surface-3" aria-label="Memuat sesi" />
        ) : currentUser ? (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-3 py-1 pl-1 pr-2.5 transition-colors hover:border-border-strong"
              aria-expanded={menuOpen}
              aria-label="Buka pengaturan akun"
            >
              <span className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent-blue text-[11px] font-bold text-white">
                {currentUser.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="hidden text-left lg:block">
                <span className="block max-w-32 truncate text-[12px] font-semibold leading-tight">{currentUser.name}</span>
                <span className="block text-[10px] leading-tight text-muted-2">{currentUser.plan}</span>
              </span>
              <ChevronDown className="hidden size-3.5 text-muted-2 sm:block" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-border bg-surface-2 p-3 shadow-xl">
                <p className="truncate text-[12px] font-semibold">{currentUser.email}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-2">{currentUser.role} · {currentUser.plan}</p>
                <Link onClick={() => setMenuOpen(false)} href="/account" className="mt-3 flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-muted hover:bg-surface-3 hover:text-foreground"><Settings className="size-4" />Pengaturan Akun</Link>
                {currentUser.role === "ADMIN" && <Link onClick={() => setMenuOpen(false)} href="/admin" className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-muted hover:bg-surface-3 hover:text-foreground">Panel Admin</Link>}
                <button onClick={async () => { await authClient.signOut(); notifyAuthStateChanged(); setCurrentUser(null); setMenuOpen(false); router.push("/"); router.refresh(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-negative hover:bg-negative/10"><LogOut className="size-4" />Keluar</button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link href="/login" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-3 px-3 text-xs font-bold text-foreground transition-colors hover:border-border-strong hover:bg-surface-2">
              <LogIn className="size-3.5" />
              <span className="hidden sm:inline">Masuk</span>
            </Link>
            <Link href="/register" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-white transition-opacity hover:opacity-90">
              <UserPlus className="size-3.5" />
              <span className="hidden sm:inline">Daftar</span>
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
