import {
  readTranscriptModule,
  readTranscriptSource,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [card, overview, steps, transcript, en, zh] = await Promise.all([
  readTranscriptModule("TurnProgressCard.tsx"),
  readTranscriptModule("TurnProgressOverview.tsx"),
  readTranscriptModule("TurnProgressSteps.tsx"),
  readTranscriptSource(),
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
  assert.match(card, /from "\.\.\/\.\.\/\.\.\/lib\/turn-progress"/);
  assert.match(
    card,
    /import \{ TurnProgressOverview \} from "\.\/TurnProgressOverview"/,
  );
  // Derived from the transcript's own turn entry: no store state, IPC call, or
  // second copy of the tool rows.
  assert.doesNotMatch(card, /useAppStore|api\.|window\.__pi|invoke\(/);
  // Composer owns abort; the card must not compete with it.
  assert.doesNotMatch(card, /onAbort|abort|stopTurn/);

  // The button is the thread's shared floating button and carries one glyph:
  // the phase, the clock, and the active step all moved into the overview it
  // pops, so nothing on the message surface competes with the messages.
  assert.match(card, /className="thread-float-btn turn-progress-head"/);
  assert.match(card, /import \{ IconMore \} from "\.\.\/\.\.\/\.\.\/components\/icons"/);
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
  // ADR 0264: the running turn owns the card. No activity and no rows is the
  // only empty card, and the clock starts from the activity's own start when
  // there is no entry to time from.
  assert.match(card, /const isEmpty = steps === 0 && !activity;/);
  assert.match(
    card,
    /const startedAt = progress\?\.startedAt \?\? activity\?\.since \?\? now;/,
  );
  // Overview, not details: the card never renders per-file change figures.
  assert.doesNotMatch(card, /filesChanged|additions|deletions/);

  // The overview is the only place the phase, the clock, and the steps are
  // drawn, and it looks like an overview rather than a second transcript. The
  // step rows and the footer render only when the running turn has steps.
  assert.match(overview, /import \{ TurnProgressSteps \} from "\.\/TurnProgressSteps"/);
  assert.match(overview, /className="turn-progress-popup" id=\{id\}/);
  assert.match(overview, /const steps = progress\?\.steps \?\? 0;/);
  assert.match(overview, /className="turn-progress-headline" aria-hidden="true"/);
  assert.match(overview, /<span className="turn-progress-status">\{status\}<\/span>/);
  assert.match(overview, /<span className="turn-progress-metrics">\{elapsed\}<\/span>/);
  assert.match(overview, /activeLabel \? \(/);
  assert.match(overview, /className="turn-progress-active"/);
  assert.match(overview, /\{steps > 0 \? \(/);
  assert.match(overview, /t\("chat\.turnProgressSteps"/);
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
  // card is a decision, and §2.4 keeps it out of the progress surfaces. The
  // gate itself lives in its own module (ADR 0264) so the transcript keeps
  // only the wiring.
  assert.match(
    transcript,
    /import \{ turnProgressGate \} from "\.\/turn-progress-gate"/,
  );
  assert.match(transcript, /const progressCard = turnProgressGate\(\{/);
  assert.match(transcript, /running: transcriptRunning,/);
  assert.match(
    transcript,
    /interrupted: Boolean\(pendingPermission \|\| askPending \|\| approvalPending\),/,
  );
  assert.match(
    transcript,
    /<TurnProgressCard[\s\S]*?entry=\{progressCard\.entry\}[\s\S]*?hidden=\{!progressCard\.onScreen\}\s*\/>/,
  );
  // Persistent: follow state is not part of the gate (ADR 0260).
  assert.doesNotMatch(transcript, /turnProgressGate\(\{[\s\S]{0,220}?showJump/);
  // The button never owns jump-to-latest: the transcript's own control keeps
  // that job whether the progress card is on screen or not.
  assert.doesNotMatch(transcript, /showReturn/);
  assert.match(
    transcript,
    /\{\(showJump \|\| readingWindow\) && !veilCovering \? \(/,
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
