"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

/** How far apart two blocks in the same group arrive. */
const STEP_MS = 60;

/**
 * The last step that still adds delay.
 *
 * Past roughly a third of a second the stagger stops reading as "in order" and
 * starts reading as "slow", so a long list bunches up at the end rather than
 * trailing off.
 */
const MAX_STEP = 5;

/**
 * How long to wait for the observer to say anything at all.
 *
 * An IntersectionObserver reports on every target it is given, intersecting or
 * not, on its first pass. Silence past this point means the observer is not
 * running — an engine without support, a tab that never painted — and the
 * element is shown rather than left waiting for a callback that is not coming.
 */
const FAILSAFE_MS = 1_200;

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * A block that arrives when it is scrolled to.
 *
 * The important property is which way this fails. The markup React renders is
 * plain and visible: no opacity, no transform, nothing that needs undoing. The
 * hiding is done afterwards, by the same effect that sets up the observer that
 * will undo it — so an element can only be hidden by code that is already
 * running and has already arranged to show it again. If the script never runs,
 * if the browser has no observer, if the reader has asked for less motion, the
 * page is simply there. An entrance animation is decoration, and decoration
 * that can swallow the page is not worth having.
 *
 * Hiding happens in a layout effect, before the browser paints, so nothing
 * flashes in and back out on the way.
 */
export function Reveal({
  as: Tag = "div",
  step = 0,
  stagger = false,
  className,
  children,
}: {
  /** The element to render, so a landmark stays a landmark. */
  as?: "div" | "section" | "header";
  /** Position in a stagger; the delay grows with it, up to a cap. */
  step?: number;
  /**
   * Animate the children one after another instead of the block as a whole.
   *
   * The wrapper stays the layout element — give it the grid or flex classes the
   * children were already laid out by — so turning a row into a stagger does
   * not insert a box between a grid and its items and quietly break their
   * alignment.
   */
  stagger?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const clampedStep = Math.min(Math.max(step, 0), MAX_STEP);

  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;

    node.dataset.reveal = "armed";
    let reported = false;

    const play = () => {
      node.dataset.reveal = "in";
    };

    const observer = new IntersectionObserver(
      (entries) => {
        reported = true;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          play();
          observer.disconnect();
        }
      },
      // A little short of the bottom edge, so a block starts moving once it is
      // properly on screen rather than while its first pixel is still below it.
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);

    const failsafe = window.setTimeout(() => {
      if (reported) return;
      play();
      observer.disconnect();
    }, FAILSAFE_MS);

    return () => {
      observer.disconnect();
      window.clearTimeout(failsafe);
    };
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement & HTMLElement>}
      className={className}
      data-stagger={stagger ? "" : undefined}
      style={stagger ? undefined : { animationDelay: `${clampedStep * STEP_MS}ms` }}
    >
      {children}
    </Tag>
  );
}
