"use client";

import Image from "next/image";
import { useTheme } from "@/presentation/hooks/use-ui-preference";
import type { Theme } from "@/shared/lib/ui-preferences";

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
  dark: "/logo/latest/lockup-dark.png",
  light: "/logo/latest/lockup-light.png",
} as const;

const MARK_SRC = {
  dark: "/logo/latest/mark-dark.png",
  light: "/logo/latest/mark-light.png",
} as const;

/** Ink boxes measured from the supplied 276px canvases. */
const LOCKUP_INK = { x: 33, y: 123, width: 212, height: 30 } as const;
const MARK_INK = { x: 79, y: 96, width: 115, height: 83 } as const;
const ARTBOARD = 276;

export function BrandLockup({
  height = 30,
  className = "",
  tone,
}: {
  height?: number;
  className?: string;
  /**
   * Which ink to use, when the surface has already committed to one. The
   * landing page is dark whatever the reader's theme, and asking the theme
   * there would hand it the dark-ink artwork on a near-black field.
   */
  tone?: Theme;
}) {
  const { theme } = useTheme();
  const scale = height / LOCKUP_INK.height;
  return (
    <span
      className={`relative inline-block shrink-0 overflow-hidden align-middle ${className}`}
      style={{ width: LOCKUP_INK.width * scale, height }}
    >
      <Image
        src={LOCKUP_SRC[tone ?? theme]}
        alt={BRAND_NAME}
        width={ARTBOARD}
        height={ARTBOARD}
        priority
        unoptimized
        className="absolute max-w-none"
        style={{
          width: ARTBOARD * scale,
          height: ARTBOARD * scale,
          left: -LOCKUP_INK.x * scale,
          top: -LOCKUP_INK.y * scale,
        }}
      />
    </span>
  );
}

/**
 * The mark alone, for places too narrow to carry the name.
 *
 * `size` is its height. The mark is a reclining S and is half again as wide as
 * it is tall, so squaring it off would squash the curve that makes it the
 * mark; callers give it the room instead.
 */
export function BrandMark({
  size = 32,
  className = "",
  tone,
}: {
  size?: number;
  className?: string;
  /** Which ink to use, when the surface has already committed to one. */
  tone?: Theme;
}) {
  const { theme } = useTheme();
  const scale = size / MARK_INK.height;
  return (
    <span
      className={`relative inline-block shrink-0 overflow-hidden align-middle ${className}`}
      style={{ width: MARK_INK.width * scale, height: size }}
    >
      <Image
        src={MARK_SRC[tone ?? theme]}
        alt={BRAND_NAME}
        width={ARTBOARD}
        height={ARTBOARD}
        priority
        unoptimized
        className="absolute max-w-none"
        style={{
          width: ARTBOARD * scale,
          height: ARTBOARD * scale,
          left: -MARK_INK.x * scale,
          top: -MARK_INK.y * scale,
        }}
      />
    </span>
  );
}
