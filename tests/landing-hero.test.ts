import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const workspace = process.cwd();
const css = readFileSync(join(workspace, "src", "app", "globals.css"), "utf8");
const landing = readFileSync(
  join(workspace, "src", "presentation", "features", "landing", "landing-page.tsx"),
  "utf8",
);

const hero = landing.slice(landing.indexOf("function Hero"), landing.indexOf("function About"));
const header = landing.match(/<header className="([^"]*)"/)?.[1] ?? "";

test("the landing bar's height is stated once", () => {
  assert.match(
    css,
    /--landing-bar:\s*\d+px;/,
    "no --landing-bar token for the bar and the hero to share",
  );
  assert.match(
    header,
    /h-\(--landing-bar\)/,
    "the bar sets its own height instead of reading the shared token",
  );
});

test("the hero is sized against the bar, never against a guessed fraction", () => {
  const section = hero.match(/<section className="([^"]*)"/)?.[1] ?? "";
  assert.ok(section.length > 0, "could not find the hero section");

  // A percentage of the viewport cannot know how tall the bar above it is. The
  // two used to be picked independently — 58px and 86vh — and on a 960px-tall
  // window that left the next section 76px above the fold, which reads as the
  // hero being cut off.
  assert.doesNotMatch(
    section,
    /min-h-\[\d+(?:\.\d+)?[ds]?vh\]/,
    "the hero claims a fraction of the viewport, which cannot account for the bar",
  );
  assert.match(
    section,
    /min-h-\[calc\(100dvh-var\(--landing-bar\)\)\]/,
    "the hero is not the viewport minus the bar, so the two do not fill one screen",
  );
});

test("the first screen is measured in dynamic viewport units", () => {
  // `vh` on a phone means the viewport with the URL bar hidden, so a hero sized
  // in it hangs below the bottom edge while that bar is still showing.
  const section = hero.match(/<section className="([^"]*)"/)?.[1] ?? "";
  assert.doesNotMatch(
    section,
    /100vh/,
    "static vh leaves the hero's foot under a phone's URL bar",
  );
});
