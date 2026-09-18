"use client";

import { useState, type ReactNode } from "react";
import { AppSidebar } from "@/presentation/layout/app-sidebar";
import { AppTopBar } from "@/presentation/layout/app-topbar";
import { MobileNav } from "@/presentation/layout/mobile-nav";

/**
 * The frame every signed-in page sits in.
 *
 * The document is the scroller now. It used to be a nested
 * `<main class="overflow-y-auto">` inside a `h-dvh` box, and inside a nested
 * scroller every smooth scroll in the app was a silent no-op — measured, twice.
 * A fixed rail and a sticky bar give the same layout back without taking the
 * page's own scrolling away from it.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="cs-app min-h-dvh bg-background text-foreground">
      <AppSidebar />
      <div className="app-main min-h-dvh">
        <AppTopBar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="px-3 pb-24 sm:px-4 lg:pb-6">{children}</main>
      </div>
      <MobileNav open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
    </div>
  );
}
