import {
  readTranscriptModule,
  readTranscriptSource,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [card, steps, transcript, globalsCss, progressStyles, shellStyles, en, zh] =
  await Promise.all([
  readTranscriptModule("TurnProgressCard.tsx"),
  readTranscriptModule("TurnProgressSteps.tsx"),
  readTranscriptSource(),
  read("../src/styles/globals.css"),
  read("../src/styles/turn-progress.css"),
  read("../src/styles/chat-shell.css"),
  read("../../../packages/i18n/src/locales/en/index.ts"),
  read("../../../packages/i18n/src/locales/zh-CN/index.ts"),
]);

/* ADR 0263 wears ADR 0260's declared list as a glyph button: the jump control's
 * twin, three dots instead of an arrow, standing below the conversation topbar
 * with its overview popping beneath it and dismissing itself — never a strip
 * lying over the newest messages or the composer. It owns neither
 * jump-to-latest nor a stop control. */
test("the running turn's card is a glyph button whose overview dismisses itself", () => {
  assert.match(card, /data-testid="turn-progress-card"/);
  assert.match(card, /const progress = turnProgress\(entry, now\)/);
  assert.match(card, /runActivityLabel\(activity, t as Translate, now\)/);
  assert.match(card, /from "..\/..\/..\/lib\/turn-progress"/);
  assert.match(card, /import \{ TurnProgressSteps \} from "\.\/TurnProgressSteps"/);
  // Derived from the transcript's own turn entry: no store state, IPC call, or
  // second copy of the tool rows.
  assert.doesNotMatch(card, /useAppStore|api\.|window\.__pi|invoke\(/);
  // Composer owns abort; the card must not compete with it.
  assert.doesNotMatch(card, /onAbort|abort|stopTurn/);

  // The button is the thread's shared floating button and carries one glyph:
  // the phase, the clock, and the active step all moved into the overview it
  // pops, so nothing on the message surface competes with the messages.
  assert.match(card, /className="thread-float-btn turn-progress-head"/);
  assert.match(card, /import \{ IconMore \} from "..\/..\/..\/components\/icons"/);
  assert.match(card, />\s*<IconMore size=\{16\} \/>\s*<\/TooltipButton>/);
  assert.match(card, /aria-label=\{t\("chat\.turnProgressLabel"/);
  assert.match(
    card,
    /tooltip=\{t\("chat\.turnProgressShowSteps", "Show this turn's steps"\)\}/,
  );
  assert.doesNotMatch(card, /turn-progress-dot|turn-progress-caret|turn-progress-action/);
  assert.doesNotMatch(card, /IconChevronRight/);

  // Collapsed by default; clicking it pops the overview — with or without a
  // declared list, since the overview also carries the phase and the clock —
  // which dismisses itself five seconds later and never survives an off-screen
  // round trip. Reading it holds it open.
  assert.match(card, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(card, /aria-controls=\{popupId\}/);
  assert.match(card, /onClick=\{\(\) => setOpen\(\(value\) => !value\)\}/);
  assert.match(card, /className="turn-progress-popup"/);
  assert.match(card, /TURN_PROGRESS_POPUP_AUTO_HIDE_MS = 5000/);
  assert.match(
    card,
    /window\.setTimeout\(\s*\(\) => setOpen\(false\),\s*TURN_PROGRESS_POPUP_AUTO_HIDE_MS,?\s*\)/,
  );
  assert.match(card, /if \(!open \|\| hidden \|\| held\) return;/);
  assert.match(card, /onPointerEnter=\{\(\) => setHeld\(true\)\}/);
  assert.match(card, /onFocus=\{\(\) => setHeld\(true\)\}/);
  assert.match(card, /if \(hidden\) setOpen\(false\)/);
  assert.match(card, /hidden=\{hidden \|\| isEmpty\}/);
  assert.match(card, /\{open \? \(/);
  // Overview, not details: the card never renders per-file change figures.
  assert.doesNotMatch(card, /filesChanged|additions|deletions/);

  // The overview is the only place the phase, the clock, and the steps are
  // drawn, and it looks like an overview rather than a second transcript.
  assert.match(card, /className="turn-progress-headline" aria-hidden="true"/);
  assert.match(card, /<span className="turn-progress-status">\{status\}<\/span>/);
  assert.match(card, /<span className="turn-progress-metrics">\{elapsed\}<\/span>/);
  assert.match(card, /className="turn-progress-active"/);
  assert.match(card, /\{steps > 0 \? \(/);
  assert.match(card, /t\("chat\.turnProgressSteps"/);
  assert.match(
    steps,
    /const STEP_STATUS_KEYS: Record<TurnProgressStatus, string>/,
  );
  assert.match(steps, /className="turn-progress-step-marker/);
  assert.match(steps, /data-status=\{step\.status\}/);
  assert.match(steps, /className="turn-progress-sr"/);
  assert.match(steps, /t\("chat\.turnProgressEarlier"/);

  // The phase is spoken from a hidden live region, and it follows the phase
  // rather than the clock or the retry countdown: a label that ticks every
  // second would talk over the transcript.
  assert.match(
    card,
    /className="turn-progress-sr" role="status" aria-live="polite"/,
  );
  assert.match(card, /const \[spoken, setSpoken\] = useState\(""\)/);
  assert.match(card, /setSpoken\(status\);\s*\}, \[phase\]\);/);
  assert.doesNotMatch(card, /<section[\s\S]{0,400}aria-live/);

  // The clock is drawn in the overview, so it ticks only while it is up.
  assert.match(card, /if \(hidden \|\| !open\) return;/);
  assert.match(card, /window\.setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/);
  assert.match(card, /return \(\) => window\.clearInterval\(timer\)/);

  assert.match(transcript, /import \{ TurnProgressCard \} from "\.\/TurnProgressCard"/);
  // An actionable interruption comes first: a permission, question, or approval
  // card is a decision, and §2.4 keeps it out of the progress surfaces.
  assert.match(
    transcript,
    /const progressTurnEntry =\s*transcriptRunning &&\s*!pendingPermission &&\s*!askPending &&\s*!approvalPending &&\s*tailEntry\?\.kind === "assistant-turn"/,
  );
  // Persistent: follow state is not part of the gate (ADR 0260).
  assert.match(
    transcript,
    /const progressCardOnScreen =\s*progressTurnEntry !== null && paneVisible && !veilCovering/,
  );
  assert.doesNotMatch(
    transcript,
    /const progressCardOnScreen =[\s\S]{0,140}?showJump/,
  );
  assert.match(
    transcript,
    /<TurnProgressCard[\s\S]*?hidden=\{!progressCardOnScreen\}\s*\/>/,
  );
  // The button never owns jump-to-latest: the transcript's own control keeps
  // that job whether the progress card is on screen or not.
  assert.doesNotMatch(transcript, /showReturn/);
  assert.match(
    transcript,
    /\{\(showJump \|\| readingWindow\) && !veilCovering \? \(/,
  );

  // One stylesheet owns the surface; the shell keeps none of it beyond the
  // floating button chrome the two controls share.
  assert.match(globalsCss, /@import "\.\/turn-progress\.css";/);
  assert.doesNotMatch(shellStyles, /\.turn-progress-card/);
  // The card is a layer over the thread area: it centers its two children and
  // takes no clicks of its own. Its content starts below the topbar band, which
  // is absolutely positioned over the pane and paints above this layer — an
  // overlay drawn inside that band is never seen (ADR 0263).
  assert.match(
    progressStyles,
    /\.turn-progress-card\s*\{[^}]*?inset:\s*0;[^}]*?padding:\s*calc\(var\(--ds-toolbar-height\) \+ 12px\) 32px 16px;[^}]*?pointer-events:\s*none;/,
  );
  assert.match(
    progressStyles,
    /\.turn-progress-card\[hidden\]\s*\{\s*display:\s*none;\s*\}/,
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
  assert.match(progressStyles, /\.turn-progress-steps\s*\{[^}]*?gap:\s*10px;/);
  assert.match(
    progressStyles,
    /\.turn-progress-step-label\s*\{\s*overflow-wrap:\s*anywhere;\s*\}/,
  );
  assert.match(progressStyles, /\.turn-progress-foot\s*\{/);
  assert.match(progressStyles, /\.turn-progress-step-marker\.is-active\s*\{/);
  // Typography and radii come from the token scales (check-style-tokens.mjs).
  assert.doesNotMatch(progressStyles, /border-radius:\s*999px/);
  assert.doesNotMatch(progressStyles, /line-height:\s*1\.7/);
  assert.match(
    progressStyles,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.turn-progress-card > \.turn-progress-head,\s*\.turn-progress-popup \{\s*animation: none;/,
  );
  assert.match(
    progressStyles,
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

  for (const catalog of [en, zh]) {
    assert.match(catalog, /turnProgressLabel:/);
    assert.match(catalog, /turnProgressShowSteps:/);
    assert.match(catalog, /turnProgressEarlier_one:/);
    assert.match(catalog, /turnProgressEarlier_other:/);
    assert.match(catalog, /turnProgressSteps:/);
    assert.match(catalog, /turnProgressStepPending:/);
    assert.match(catalog, /turnProgressStepActive:/);
    assert.match(catalog, /turnProgressStepDone:/);
    assert.match(catalog, /turnProgressStepError:/);
  }
});
