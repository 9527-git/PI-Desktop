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

/* ADR 0261 wears ADR 0260's declared list as a pill: one compact button
 * floating at the top of the thread area, its step overview popping beneath
 * it and dismissing itself, never a strip lying over the composer — and it
 * owns neither jump-to-latest nor a stop control. */
test("the running turn's card is a pill whose overview dismisses itself", () => {
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

  // Collapsed pill by default; clicking it pops the overview, which dismisses
  // itself five seconds later and never survives an off-screen round trip.
  assert.match(card, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(card, /aria-controls=\{popupId\}/);
  assert.match(card, /className="turn-progress-popup"/);
  assert.match(card, /TURN_PROGRESS_POPUP_AUTO_HIDE_MS = 5000/);
  assert.match(
    card,
    /window\.setTimeout\(\s*\(\) => setOpen\(false\),\s*TURN_PROGRESS_POPUP_AUTO_HIDE_MS,?\s*\)/,
  );
  assert.match(card, /if \(hidden\) setOpen\(false\)/);
  // Overview, not details: the card never renders per-file change figures.
  assert.doesNotMatch(card, /filesChanged|additions|deletions/);

  // The checklist itself lives in its own module: one marker per status, one
  // state word per marker for the reader that cannot see the glyph.
  assert.match(
    steps,
    /const STEP_STATUS_KEYS: Record<TurnProgressStatus, string>/,
  );
  assert.match(steps, /className="turn-progress-step-marker/);
  assert.match(steps, /data-status=\{step\.status\}/);
  assert.match(steps, /className="turn-progress-sr"/);
  assert.match(steps, /t\("chat\.turnProgressEarlier"/);
  assert.match(card, /t\("chat\.turnProgressSteps"/);

  // Only the status line is a live region; the elapsed timer ticks every second,
  // so announcing the card as a whole would talk over the transcript.
  assert.match(
    card,
    /className="turn-progress-status" role="status" aria-live="polite"/,
  );
  assert.doesNotMatch(card, /<section[\s\S]{0,400}aria-live/);
  assert.match(card, /className="turn-progress-metrics" aria-hidden="true"/);

  // The 1s timer is the card's own cost, so it stops when the card is hidden.
  assert.match(card, /if \(hidden\) return;/);
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
  // The pill never owns jump-to-latest: the transcript's pill keeps that
  // control whether the progress card is on screen or not.
  assert.doesNotMatch(transcript, /showReturn/);
  assert.match(
    transcript,
    /\{\(showJump \|\| readingWindow\) && !veilCovering \? \(/,
  );

  // One stylesheet owns the surface; the shell keeps none of it.
  assert.match(globalsCss, /@import "\.\/turn-progress\.css";/);
  assert.doesNotMatch(shellStyles, /\.turn-progress-card/);
  // A top-centered floating layer, never a bottom strip over the composer.
  assert.match(
    progressStyles,
    /\.turn-progress-card\s*\{[^}]*?top:\s*12px;[^}]*?left:\s*50%;/,
  );
  assert.match(
    progressStyles,
    /\.turn-progress-card\[hidden\]\s*\{\s*display:\s*none;\s*\}/,
  );
  // The popup reads as an overview: larger type, looser lines.
  assert.match(
    progressStyles,
    /\.turn-progress-popup\s*\{[^}]*?font-size:\s*var\(--text-md\);[^}]*?line-height:\s*1\.7;/,
  );
  assert.match(progressStyles, /\.turn-progress-steps\s*\{[^}]*?gap:\s*7px;/);
  assert.match(progressStyles, /\.turn-progress-foot\s*\{/);
  assert.match(progressStyles, /\.turn-progress-step-marker\.is-active\s*\{/);
  assert.match(
    progressStyles,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.turn-progress-card,\s*\.turn-progress-popup \{\s*animation: none;/,
  );
  assert.match(
    progressStyles,
    /\.turn-progress-step-marker\.is-active \{\s*animation: none;\s*\}/,
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
