import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const workspace = process.cwd();
const css = readFileSync(join(workspace, "src", "app", "globals.css"), "utf8");
const reveal = readFileSync(
  join(workspace, "src", "presentation", "ui", "reveal.tsx"),
  "utf8",
);

/** The stylesheet with every `@keyframes` body removed. */
function withoutKeyframes(stylesheet: string): string {
  return stylesheet.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
}

/** Every `@utility animate-*` as a `[name, animation shorthand]` pair. */
function utilities(): Array<[string, string]> {
  return [...css.matchAll(/@utility\s+(animate-[a-z-]+)\s*\{\s*animation:([^;]+);/g)].map(
    (match) => [match[1], match[2]],
  );
}

/** An animation that repeats forever is ambience; anything else is an entrance. */
function isAmbient(shorthand: string): boolean {
  return /\binfinite\b/.test(shorthand);
}

/** The body of one `@keyframes` block. */
function keyframes(name: string): string {
  const block = css.match(new RegExp(String.raw`@keyframes\s+${name}\s*\{([\s\S]*?)\n\}`));
  assert.ok(block, `no @keyframes ${name}`);
  return block[1];
}

test("an entrance animation never outlives itself", () => {
  const entrances = utilities().filter(([, shorthand]) => !isAmbient(shorthand));
  assert.ok(entrances.length > 0, "found no entrance utilities to check");

  for (const [name, shorthand] of entrances) {
    // `forwards` or `both` would hold the final keyframe indefinitely, which
    // makes an element's visibility depend on its animation having run. These
    // fill only backwards, through the delay, and then hand the element back to
    // its own styles.
    assert.doesNotMatch(
      shorthand,
      /\b(?:both|forwards)\b/,
      `${name} holds a keyframe after it ends; content would depend on it running`,
    );
    assert.match(
      shorthand,
      /\bbackwards\b/,
      `${name} has no backwards fill, so a staggered delay would flash before it starts`,
    );
  }
});

test("ambience is never the thing that makes something visible", () => {
  const ambient = utilities().filter(([, shorthand]) => isAmbient(shorthand));
  assert.ok(ambient.length > 0, "found no ambient utilities to check");

  for (const [name, shorthand] of ambient) {
    // A loop has no end to fill towards, so a fill mode could only pin it to a
    // state it never settles in. Without one, what it rests in when the
    // animation is off is the element's own styles.
    assert.doesNotMatch(
      shorthand,
      /\b(?:both|forwards|backwards)\b/,
      `${name} takes a fill mode, but an endless animation has nothing to fill towards`,
    );

    // Decoration that fades up from nothing would leave the page flat wherever
    // the animation does not run — the same failure the reveals are built to
    // avoid, moved into the background.
    const animation = shorthand.match(/\b(cs-[a-z-]+)\b/)?.[1];
    assert.ok(animation, `${name} names no cs-* keyframes`);
    const start = keyframes(animation).match(/from\s*\{[^}]*opacity:\s*([\d.]+)/)?.[1];
    if (start !== undefined) {
      assert.ok(
        Number(start) > 0,
        `${animation} starts fully transparent, so the page is flat until it runs`,
      );
    }
  }
});

test("nothing is hidden except by the attribute the script also clears", () => {
  const rules = [
    ...withoutKeyframes(css).matchAll(/([^{}]+)\{[^{}]*opacity:\s*0\s*;/g),
  ].map((match) => match[1].trim().replace(/\s+/g, " "));
  assert.ok(rules.length > 0, "found no hiding rules to check");

  for (const selector of rules) {
    assert.match(
      selector,
      /\[data-reveal="armed"\]/,
      `"${selector}" hides content without an armed reveal to bring it back`,
    );
  }
});

test("the markup a reveal renders carries no hiding of its own", () => {
  const jsx = reveal.slice(reveal.lastIndexOf("  return ("));
  assert.ok(jsx.includes("<Tag"), "could not find the element the reveal renders");

  // The server sends a plain element. Only the effect writes `data-reveal`, and
  // that effect is also what arranges to clear it — so an element can only be
  // hidden by code that is already running and already committed to showing it.
  assert.doesNotMatch(
    jsx,
    /data-reveal/,
    "the rendered markup arms itself, so a page without JavaScript stays blank",
  );
  assert.match(reveal, /dataset\.reveal = "armed"/);
  assert.match(reveal, /dataset\.reveal = "in"/);
});

test("a reveal the observer never reports on shows itself anyway", () => {
  const failsafe = reveal.match(/setTimeout\(\(\) => \{([\s\S]*?)\}, FAILSAFE_MS\)/);
  assert.ok(failsafe, "the reveal has no failsafe for a silent observer");
  assert.match(
    failsafe[1],
    /\bplay\(\)/,
    "the failsafe fires without showing the element it armed",
  );
});

test("asking for less motion removes every animation, not just the entrances", () => {
  const block = css.match(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
  );
  assert.ok(block, "no reduced-motion block");
  const guarded = block.join("\n");

  for (const [name] of utilities()) {
    assert.ok(
      guarded.includes(`.${name}`),
      `${name} still animates for a reader who asked it not to`,
    );
  }
  assert.ok(
    guarded.includes("[data-reveal]"),
    "scroll reveals still animate for a reader who asked them not to",
  );
});
