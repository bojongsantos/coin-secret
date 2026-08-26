"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface TooltipProps {
  content: string;
  children: ReactNode;
}

/**
 * Lightweight accessible tooltip.
 * - Desktop (fine pointer): shows on hover and on keyboard focus.
 * - Touch (coarse pointer): toggles on tap, closes on outside tap.
 * - Positions above the trigger by default, flips below if clipped, and
 *   clamps horizontally so it never overflows the viewport.
 */
export function Tooltip({ content, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [coarse] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
  );

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const t = trigger.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let top = t.top - th - 8;
    if (top < 8) top = t.bottom + 8;
    let left = t.left + t.width / 2 - tw / 2;
    left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // Close when tapping/clicking outside (touch + desktop fallback).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const tip = tipRef.current;
      const trigger = triggerRef.current;
      if (tip && !tip.contains(e.target as Node) && trigger && !trigger.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <span ref={triggerRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={content}
        className="inline-flex cursor-help items-center rounded-sm text-muted-2 transition-colors hover:text-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        onMouseEnter={coarse ? undefined : () => setOpen(true)}
        onMouseLeave={coarse ? undefined : () => setOpen(false)}
        onClick={coarse ? () => setOpen((v) => !v) : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </button>
      {open && (
        <div
          ref={tipRef}
          role="tooltip"
          className={`pointer-events-none fixed z-50 max-w-[240px] whitespace-pre-line rounded-md border border-border-strong bg-[#101018] px-2.5 py-2 text-[11px] leading-snug text-white/85 shadow-xl ${
            pos ? "opacity-100" : "invisible opacity-0"
          }`}
          style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0 }}
        >
          {content}
        </div>
      )}
    </span>
  );
}
