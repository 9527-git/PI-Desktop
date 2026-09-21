import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [globalsCss, progressStyles, overviewStyles, shellStyles] =
  await Promise.all([
    read("../src/styles/globals.css"),
    read("../src/styles/turn-progress.css"),
    read("../src/styles/turn-progress-overview.css"),
    read("../src/styles/chat-shell.css"),
  ]);

/* ADR 0263/0264/0265: the card is a layer over the thread area whose glyph
 * button stands centered above the composer, worn as the jump control's twin.
 * One surface, two partials: `turn-progress.css` owns the layer, the button,
 * and the popup shell; `turn-progress-overview.css` owns the overview's own
 * internals. */
test("the card's stylesheet keeps its layer, its bound, and its twin", () => {
  // Both partials of the surface are sequenced by the entry file; the shell
  // keeps none of it beyond the floating button chrome the two share.
  assert.match(globalsCss, /@import "\.\/turn-progress\.css";/);
  assert.match(globalsCss, /@import "\.\/turn-progress-overview\.css";/);
  assert.doesNotMatch(shellStyles, /\.turn-progress-card/);
  // The card is a layer over the thread area: it centers its two children on
  // the reading column's floor and takes no clicks of its own. The layer is
  // bottom-aligned, so the button stands in the gutter above the docked
  // composer instead of under the topbar band (ADR 0265).
  assert.match(
    progressStyles,
    /\.turn-progress-card\s*\{[^}]*?inset:\s*0;[^}]*?justify-content:\s*flex-end;[^}]*?padding:\s*16px 32px 12px;[^}]*?pointer-events:\s*none;/,
  );
  assert.match(
    progressStyles,
    /\.turn-progress-card\[hidden\]\s*\{\s*display:\s*none;\s*\}/,
  );

  // The popup is drawn above the button while the button keeps its DOM place
  // as the trigger: flex order moves the paint, not the tab stop (ADR 0265).
  assert.match(
    progressStyles,
    /\.turn-progress-card > \.turn-progress-popup\s*\{\s*order:\s*-1;\s*\}/,
  );
  assert.match(
    progressStyles,
    /\.turn-progress-popup\s*\{[^}]*?margin-bottom:\s*6px;/,
  );
  // Entry animations come from the composer's side, never from the topbar's.
  assert.match(
    progressStyles,
    /@keyframes turn-progress-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*translate:\s*0 6px;/,
  );
  // The overview reads as an overview: larger type, looser lines, and a bound
  // that keeps a message row clear above the newest messages.
  assert.match(
    progressStyles,
    /\.turn-progress-popup\s*\{[^}]*?font-size:\s*var\(--text-base-plus\);[^}]*?line-height:\s*var\(--leading-prose\);/,
  );
  assert.match(
    progressStyles,
    /\.turn-progress-popup\s*\{[^}]*?max-height:\s*min\(46vh, 360px, max\(140px, calc\(100% - 78px\)\)\);[^}]*?overflow-y:\s*auto;/,
  );
  assert.match(overviewStyles, /\.turn-progress-steps\s*\{[^}]*?gap:\s*10px;/);
  assert.match(
    overviewStyles,
    /\.turn-progress-step-label\s*\{\s*overflow-wrap:\s*anywhere;\s*\}/,
  );
  assert.match(overviewStyles, /\.turn-progress-foot\s*\{/);
  assert.match(overviewStyles, /\.turn-progress-step-marker\.is-active\s*\{/);
  // The layer's partial carries none of the overview's internals.
  assert.doesNotMatch(progressStyles, /\.turn-progress-steps/);
  // Typography and radii come from the token scales (check-style-tokens.mjs).
  assert.doesNotMatch(progressStyles, /border-radius:\s*999px/);
  assert.doesNotMatch(progressStyles, /line-height:\s*1\.7/);
  assert.doesNotMatch(overviewStyles, /border-radius:\s*999px/);
  assert.doesNotMatch(overviewStyles, /line-height:\s*1\.7/);
  assert.match(
    progressStyles,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.turn-progress-card > \.turn-progress-head,\s*\.turn-progress-popup \{\s*animation: none;/,
  );
  assert.match(
    overviewStyles,
    /\.turn-progress-step-marker\.is-active \{\s*animation: none;\s*\}/,
  );

  // The two floaters are one object: the shell owns the chrome, each surface
  // owns its placement, so the jump control's look and the button's cannot
  // drift. The shared chrome is also what re-enables pointer events inside the
  // card's click-through layer, so the glyph stays clickable.
  assert.match(
    shellStyles,
    /\.jump-latest-btn,\s*\.thread-float-btn \{[^}]*?border-radius:\s*var\(--radius-round\);[^}]*?pointer-events:\s*auto;/,
  );
  // The thread's jump control leaves the middle of the pane for the reading
  // column's right edge; every other surface that reuses the class keeps the
  // centered placement.
  assert.match(shellStyles, /\.jump-latest-btn \{[^}]*?left:\s*50%;/);
  assert.match(
    shellStyles,
    /\.thread-wrap > \.jump-latest-btn \{[^}]*?left:\s*auto;[^}]*?right:\s*max\(24px,/,
  );
});
