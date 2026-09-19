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

test("renders word-bearing sidebar status pills in a fixed lane", () => {
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
  // The row still shows the session title alone, and every row keeps reserving
  // the same lane on its own left edge — now wide enough for the pill's word —
  // so the column never reflows when a session gains a state.
  assert.match(
    sidebar,
    /className="thread-item-main"[\s\S]*?\{status \? renderSessionStatus\(status\) : null\}/,
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
  // The lane is the row button's own left padding, so the pill stays inside the
  // click target, and the pill's clearance to the title column comes out of the
  // lane rather than adding to it.
  assert.match(styles, /--ds-sidebar-status-lane: 80px/);
  assert.match(styles, /--ds-sidebar-status-pill-gap: 6px/);
  assert.match(styles, /--ds-status-ink: var\(--gray-900\)/);
  assert.doesNotMatch(styles, /--ds-sidebar-status-gap|--ds-sidebar-status-column/);
  assert.doesNotMatch(styles, /thread-item-status-chip|thread-item-status-label/);
  assert.doesNotMatch(styles, /\.thread-item-preview \{/);
  const mainRule = styles.match(/^\.thread-item-main \{[^}]*\}/m)?.[0] ?? "";
  assert.match(mainRule, /padding: 5px 6px 5px var\(--ds-sidebar-status-lane\)/);
  const pillRule = styles.match(/^\.thread-item-status \{[^}]*\}/m)?.[0] ?? "";
  assert.match(pillRule, /position: absolute/);
  assert.match(pillRule, /left: 0/);
  // The pill hugs its word like a tag and the lane only caps it, so a fixed
  // `width` here would put the bar back; the cap keeps a long locale word from
  // pushing into the title column.
  assert.doesNotMatch(pillRule, /^\s*width:/m);
  assert.match(
    pillRule,
    /max-width: calc\(var\(--ds-sidebar-status-lane\) - var\(--ds-sidebar-status-pill-gap\)\)/,
  );
  assert.match(pillRule, /height: 20px/);
  assert.match(pillRule, /padding: 0 8px/);
  assert.match(pillRule, /font-size: var\(--text-2xs\)/);
  const wordRule = styles.match(/^\.thread-item-status-word \{[^}]*\}/m)?.[0] ?? "";
  assert.match(wordRule, /text-overflow: ellipsis/);
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
