/**
 * The sidebar session hover card is a summary of one session row, so it never
 * grows past that row and therefore never leaves the session column (D460).
 * The clamp is asserted behaviourally; the card's wiring and the stylesheet
 * are asserted against source, matching the local convention for modules that
 * need a DOM to run.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SESSION_HOVER_CARD_MAX_WIDTH,
  sessionHoverCardWidth,
} from "../src/features/sessions/session-collaboration-view.ts";

const hoverSource = await readFile(
  new URL("../src/features/sessions/SessionHoverCard.tsx", import.meta.url),
  "utf8",
);
const sessionsCss = await readFile(
  new URL("../src/styles/sessions.css", import.meta.url),
  "utf8",
);

test("the card never outgrows the row it summarizes", () => {
  const narrowRow = 257;
  assert.equal(sessionHoverCardWidth(narrowRow), narrowRow, "a narrow sidebar shrinks the card");
  assert.equal(
    sessionHoverCardWidth(SESSION_HOVER_CARD_MAX_WIDTH),
    SESSION_HOVER_CARD_MAX_WIDTH,
    "the cap is reachable",
  );
  assert.equal(
    sessionHoverCardWidth(900),
    SESSION_HOVER_CARD_MAX_WIDTH,
    "a wide sidebar still leaves the card a bounded summary",
  );
});

test("a missing row measurement falls back to the cap", () => {
  for (const value of [0, -10, Number.NaN]) {
    assert.equal(sessionHoverCardWidth(value), SESSION_HOVER_CARD_MAX_WIDTH, `${value} falls back`);
  }
});

test("the card applies the row width before it measures itself", () => {
  const place = hoverSource.match(/const place = \(\) => \{[\s\S]*?\n    \};/)?.[0] ?? "";
  assert.match(place, /const anchor = target\.getBoundingClientRect\(\);/, "the row rect is read once");
  assert.match(
    place,
    /element\.style\.setProperty\(\s*"--session-hover-card-width",\s*`\$\{sessionHoverCardWidth\(anchor\.width\)\}px`,\s*\);/,
    "the row width drives the card's own width variable",
  );
  const width = place.indexOf("--session-hover-card-width");
  const measured = place.indexOf("element.offsetWidth");
  assert.ok(width !== -1 && measured !== -1 && width < measured, "the width lands before the measurement");
  assert.match(place, /positionSessionHoverCard\(\s*anchor,/, "placement reuses the same rect");
});

test("the stylesheet reads the width with the same cap as its fallback", () => {
  assert.match(
    sessionsCss,
    new RegExp(
      "\\.sidebar-session-hover-card \\{[^}]*"
        + `width: min\\(var\\(--session-hover-card-width, ${SESSION_HOVER_CARD_MAX_WIDTH}px\\), `
        + "calc\\(100vw - 16px\\)\\)",
    ),
    "the card falls back to the shared cap and still yields to a narrow viewport",
  );
});
