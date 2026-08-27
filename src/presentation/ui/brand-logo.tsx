"use client";

import Image from "next/image";
import { useTheme } from "@/presentation/hooks/use-ui-preference";

/**
 * The Coin Secret wordmark and mark.
 *
 * Both are raster art, so they cannot be recoloured with CSS: each ships in
 * two inks instead, and the theme picks. `unoptimized` keeps them out of the
 * image optimizer — they are already trimmed to the ink and a few kilobytes
 * each, so a round trip through it would cost more than it saves.
 */
export const BRAND_NAME = "Coin Secret";

/**
 * The wordmark ships in two files because its lettering is pixels, not text.
 * On a light background the white name would simply disappear and leave the
 * mark floating on its own; the light file carries the same glyphs re-inked
 * dark, with the mark in the deeper blue the designer drew for white.
 */
const LOCKUP_SRC = {
  dark: "/logo/logo-text.png",
  light: "/logo/logo-text-light.png",
} as const;

const MARK_SRC = {
  dark: "/logo/mark.png",
  light: "/logo/mark-light.png",
} as const;

/** Measured from the artwork's own ink, not guessed from the canvas. */
const LOCKUP_RATIO = 844 / 105;
const MARK_RATIO = 171 / 105;

export function BrandLockup({ height = 30, className = "" }: { height?: number; className?: string }) {
  const { theme } = useTheme();
  return (
    <Image
      src={LOCKUP_SRC[theme]}
      alt={BRAND_NAME}
      width={Math.round(height * LOCKUP_RATIO)}
      height={height}
      priority
      unoptimized
      className={className}
    />
  );
}

/**
 * The mark alone, for places too narrow to carry the name.
 *
 * `size` is its height. The mark is a reclining S and is half again as wide as
 * it is tall, so squaring it off would squash the curve that makes it the
 * mark; callers give it the room instead.
 */
export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  const { theme } = useTheme();
  return (
    <Image
      src={MARK_SRC[theme]}
      alt={BRAND_NAME}
      width={Math.round(size * MARK_RATIO)}
      height={size}
      priority
      unoptimized
      className={className}
    />
  );
}
