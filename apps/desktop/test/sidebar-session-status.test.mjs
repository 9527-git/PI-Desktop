import {
  readStoreModuleSync,
  readMainSourceSync,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  latestSessionOutcomes,
  sidebarSessionStatus,
} from "../src/lib/sidebar-session-status.ts";
import { loadStylesSync } from "./helpers/styles.mjs";

function notification(overrides) {
  return {
    id: "notification-1",
    kind: "task.completed",
    sessionId: "session-1",
    sessionTitle: "Session",
    turnId: "turn-1",
    createdAt: "2026-07-27T10:00:00.000Z",
    readAt: null,
    ...overrides,
  };
}

test("keeps the newest unread completed or failed outcome for each session", () => {
  const outcomes = latestSessionOutcomes([
    notification({ id: "latest", kind: "task.completed" }),
    notification({ id: "older", kind: "task.failed" }),
    notification({
      id: "other",
      kind: "task.failed",
      sessionId: "session-2",
    }),
  ]);

  assert.deepEqual(outcomes, {
    "session-1": "completed",
    "session-2": "failed",
  });
});

test("read task notifications leave no sidebar indicator", () => {
  const outcomes = latestSessionOutcomes([
    notification({ id: "latest", readAt: "2026-07-27T10:05:00.000Z" }),
    notification({ id: "older", kind: "task.failed" }),
  ]);

  assert.deepEqual(outcomes, {});
});

test("prioritizes in-progress and selected states over terminal outcomes", () => {
  assert.equal(
    sidebarSessionStatus({ running: true, selected: true, outcome: "failed" }),
    "running",
  );
  assert.equal(
    sidebarSessionStatus({ running: false, selected: true, outcome: "failed" }),
    "selected",
  );
  assert.equal(
    sidebarSessionStatus({ running: false, selected: false, outcome: "completed" }),
    "completed",
  );
  assert.equal(sidebarSessionStatus({ running: false, selected: false }), null);
});

test("any pending intervention raises the needs-input dot above run state", () => {
  // D444: permission ∪ ask ∪ Plan/Goal approval all map to the "permission"
  // state id, and the union outranks running so a blocked agent still reads as
  // waiting on the human rather than merely working.
  for (const intervention of [
    { hasPendingPermission: true },
    { hasPendingAsk: true },
    { hasPendingPlan: true },
  ]) {
    assert.equal(
      sidebarSessionStatus({ running: true, selected: true, ...intervention }),
      "permission",
    );
    assert.equal(
      sidebarSessionStatus({ running: false, selected: false, ...intervention }),
      "permission",
    );
  }
  assert.equal(
    sidebarSessionStatus({ running: true, selected: false }),
    "running",
  );
});

test("opening a conversation acknowledges its outcome badge", () => {
  const sessionSource = readStoreModuleSync("slices/session-slice.ts");
  const catalogSource = readStoreModuleSync("slices/catalog-slice.ts");
  const selectBlock = sessionSource.match(/selectSession: async[\s\S]*?\n    newSession:/)?.[0] ?? "";
  assert.match(selectBlock, /acknowledgeSessionOutcome\(id\)/);

  const ackBlock = catalogSource.slice(
    catalogSource.indexOf("acknowledgeSessionOutcome: async"),
  );
  assert.match(ackBlock, /withoutRecordKey\(state\.sessionOutcomes, sessionId\)/);
  assert.match(ackBlock, /markNotificationRead\(item\.id\)/);
});

test("renders word-bearing sidebar status pills at the row's own edge", () => {
  const sidebar = fs.readFileSync(
    new URL("../src/components/Sidebar.tsx", import.meta.url),
    "utf8",
  );
  const styles = loadStylesSync();
  // The status fixture lives in the capture rig, which App only loads lazily
  // behind __PI_CAPTURE__.
  const app = fs.readFileSync(
    new URL("../src/capture/capture-rig.ts", import.meta.url),
    "utf8",
  );
  const main = readMainSourceSync();

  assert.match(sidebar, /sessionSelected[\s\S]*sessionCompleted[\s\S]*sessionFailed/);
  assert.match(sidebar, /IconCheck[\s\S]*IconCircleAlert/);
  // D444: the needs-input dot is the union of permission ∪ ask ∪ Plan/Goal
  // approval, and its aria/title label uses nav.sessionNeedsInput.
  assert.match(sidebar, /hasPendingAsk[\s\S]*hasPendingPlan/);
  assert.match(sidebar, /pendingAsks\[session\.id\][\s\S]*pendingPlans\[session\.id\]/);
  assert.match(sidebar, /nav\.sessionNeedsInput/);
  assert.doesNotMatch(sidebar, /nav\.sessionPermission/);
  // D451: every state pill names itself with the state's own token colour.
  assert.match(styles, /thread-item-status\.running \{[\s\S]*?--ds-warning/);
  assert.match(styles, /thread-item-status\.permission \{[\s\S]*?--ds-purple/);
  assert.match(styles, /thread-item-status\.selected \{[\s\S]*?--ds-accent/);
  assert.match(styles, /thread-item-status\.completed \{[\s\S]*?--ds-success/);
  assert.match(styles, /thread-item-status\.failed \{[\s\S]*?--ds-error/);
  // D451: the pill carries the state's short word in the row, so the state is
  // named at a glance; the full phrase stays on the pill's tooltip and
  // accessible name. The two attention states stay solid fills with the shared
  // dark ink, so they still read as mass the way the bare capsule did.
  const runningRule = styles.match(/^\.thread-item-status\.running \{[^}]*\}/m)?.[0] ?? "";
  const permissionRule =
    styles.match(/^\.thread-item-status\.permission \{[^}]*\}/m)?.[0] ?? "";
  assert.match(runningRule, /background: var\(--ds-warning\)/);
  assert.match(runningRule, /color: var\(--ds-status-ink\)/);
  assert.match(permissionRule, /background: var\(--ds-purple\)/);
  assert.match(permissionRule, /color: var\(--ds-status-ink\)/);
  assert.match(sidebar, /sessionStatusShortLabel/);
  assert.match(sidebar, /nav\.sessionRunningShort[\s\S]*nav\.sessionNeedsInputShort/);
  assert.match(sidebar, /thread-item-status-dot/);
  assert.match(sidebar, /thread-item-status-word/);
  // The marked-row layout (D455) keeps the pill at the head of its own row and
  // ahead of the title, so the marker reads as the row's own lead-in. The row
  // button carries the mark; the pill itself is rendered once and never wrapped
  // in another `.thread-item-status`, which would draw a second capsule inside
  // the first — two concentric rings for an outlined state, a double-tinted
  // fill for a translucent one.
  assert.ok(
    sidebar.includes('className={`thread-item-main ${status ? "marked" : ""}`}'),
    "the row button is marked while a state is set",
  );
  assert.equal(
    sidebar.match(/thread-item-status \$\{status\}/g)?.length,
    1,
    "exactly one element carries the pill class, so it is never nested in itself",
  );
  assert.doesNotMatch(sidebar, /thread-item-status \$\{status\} marked/);
  assert.ok(
    sidebar.includes("{status ? renderSessionStatus(status) : null}"),
    "the row renders the pill directly instead of wrapping it",
  );
  assert.ok(
    sidebar.indexOf("{status ? renderSessionStatus(status) : null}") <
      sidebar.indexOf('<span className="thread-item-title">'),
    "the pill renders before the title",
  );
  assert.doesNotMatch(sidebar, /renderSessionStatusChip|thread-item-status-chip/);
  assert.doesNotMatch(sidebar, /isAttentionStatus|thread-item-status-label/);
  assert.doesNotMatch(sidebar, /thread-item-preview|session\.lastMessage/);
  assert.doesNotMatch(sidebar, /className="thread-item-title-row/);
  for (const locale of ["de", "en", "es", "fr", "ko", "tr", "zh-CN", "zh-TW"]) {
    const source = fs.readFileSync(
      new URL(`../../../packages/i18n/src/locales/${locale}/index.ts`, import.meta.url),
      "utf8",
    );
    // Every shipped locale carries a short word per state, and a short word
    // never outgrows the full phrase it abbreviates (counted in code points, so
    // CJK labels compare fairly).
    for (const state of ["Running", "Selected", "Completed", "Failed", "NeedsInput"]) {
      const long = source.match(new RegExp(`"?session${state}"?:\\s*"([^"]+)"`));
      const short = source.match(new RegExp(`"?session${state}Short"?:\\s*"([^"]+)"`));
      assert.ok(long && short, `${locale} ships session${state} and its Short form`);
      assert.ok(
        [...short[1]].length <= [...long[1]].length,
        `${locale} session${state}Short must not outgrow the full phrase: "${short[1]}" vs "${long[1]}"`,
      );
    }
  }
  // D455: the row reserves no lane. Its own left inset is what seats the pill
  // inside the click target, the marked row's `gap: 0` lets the title follow the
  // pill's one clearance, and the lane token survives only as the pill's cap.
  assert.match(styles, /--ds-sidebar-status-lane: 80px/);
  assert.match(styles, /--ds-sidebar-status-pill-gap: 6px/);
  assert.match(styles, /--ds-status-ink: var\(--gray-900\)/);
  assert.doesNotMatch(styles, /--ds-sidebar-status-gap|--ds-sidebar-status-column/);
  assert.doesNotMatch(styles, /thread-item-status-chip|thread-item-status-label/);
  assert.doesNotMatch(styles, /\.thread-item-preview \{/);
  const mainRule = styles.match(/^\.thread-item-main \{[^}]*\}/m)?.[0] ?? "";
  // D465 raised the row's vertical inset with the pitch; the leading 4px text
  // inset and the 6px trailing inset are unchanged.
  assert.match(mainRule, /padding: 6px 6px 6px 4px/);
  assert.doesNotMatch(mainRule, /--ds-sidebar-status-lane/);
  const markedMainRule =
    styles.match(/^\.marked\.thread-item-main \{[^}]*\}/m)?.[0] ?? "";
  assert.match(markedMainRule, /gap: 0/);
  assert.doesNotMatch(markedMainRule, /padding-left/);
  const markedMarkerRule =
    styles.match(/\.marked\.thread-item-main \.thread-item-pin,[\s\S]*?\}/)?.[0] ?? "";
  assert.match(markedMarkerRule, /\.thread-item-source/);
  // Both sides of the marker keep the row's 4px rhythm, so it touches neither
  // the pill ahead of it nor the title after it.
  assert.match(markedMarkerRule, /margin-inline: 4px/);
  // The list's furniture rides the row's own text column: each one has to exist
  // (a missing selector would otherwise make the `doesNotMatch` below vacuous)
  // and each one starts on the pill's own inset. This is the static home of the
  // contract the E2E cannot render, because its throwaway profile seeds neither
  // a project group nor a non-today session.
  const furnitureRules = {
    ".sidebar-time-group-header": styles.match(
      /^\.sidebar-time-group-header \{[^}]*\}/m,
    )?.[0],
    ".sidebar-load-more": styles.match(/^\.sidebar-load-more \{[^}]*\}/m)?.[0],
    ".sidebar-session-empty": styles.match(/^\.sidebar-session-empty \{[^}]*\}/m)?.[0],
  };
  for (const [selector, rule] of Object.entries(furnitureRules)) {
    assert.ok(rule, `${selector} keeps a rule the inset can be read from`);
    assert.doesNotMatch(rule, /--ds-sidebar-status-lane/);
    const inset = rule
      .match(/padding:\s*([^;]+);/)?.[1]
      .trim()
      .split(/\s+/)
      .pop();
    assert.equal(inset, "4px", `${selector} starts on the pill's own inset`);
  }
  const pillRule = styles.match(/^\.thread-item-status \{[^}]*\}/m)?.[0] ?? "";
  assert.doesNotMatch(pillRule, /position: absolute/);
  assert.doesNotMatch(pillRule, /^\s*left:/m);
  // The pill hugs its word like a tag and the lane only caps it, so a fixed
  // `width` here would put the bar back; the cap keeps a long locale word from
  // taking the row away from the title.
  assert.doesNotMatch(pillRule, /^\s*width:/m);
  assert.match(
    pillRule,
    /max-width: calc\(var\(--ds-sidebar-status-lane\) - var\(--ds-sidebar-status-pill-gap\)\)/,
  );
  assert.match(pillRule, /height: 18px/);
  assert.match(pillRule, /padding: 0 6px/);
  assert.match(pillRule, /font-size: var\(--text-3xs\)/);
  const wordRule = styles.match(/^\.thread-item-status-word \{[^}]*\}/m)?.[0] ?? "";
  assert.match(wordRule, /text-overflow: ellipsis/);
  const markedPillRule =
    styles.match(/^\.marked \.thread-item-status \{[^}]*\}/m)?.[0] ?? "";
  assert.match(
    markedPillRule,
    /margin-right: var\(--ds-sidebar-status-pill-gap\)/,
  );
  assert.doesNotMatch(markedPillRule, /position: absolute/);
  assert.doesNotMatch(styles, /thread-item-main:has\(/);
  assert.match(
    styles,
    /prefers-reduced-motion: reduce[\s\S]*thread-item-status\.running \.thread-item-status-dot[\s\S]*animation: none/,
  );
  assert.match(
    styles,
    /prefers-reduced-motion: reduce[\s\S]*thread-item-status\.permission \.thread-item-status-dot[\s\S]*animation: none/,
  );
  assert.match(
    app,
    /seedSidebarStatuses[\s\S]*runningSessions[\s\S]*sessionOutcomes/,
  );
  assert.match(
    main,
    /PI_DESKTOP_CAPTURE_STATUS_ONLY[\s\S]*prefers-reduced-motion[\s\S]*SIDEBAR_STATUS_PROBE[\s\S]*pi-sidebar-status-/,
  );
});
