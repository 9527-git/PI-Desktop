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

test("renders semantic, shape-distinct sidebar status indicators", () => {
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
  assert.match(styles, /thread-item-status\.running::before[\s\S]*--ds-warning/);
  assert.match(styles, /thread-item-status\.permission::before[\s\S]*--ds-purple/);
  assert.match(styles, /thread-item-status\.selected::before[\s\S]*--ds-accent/);
  assert.match(styles, /thread-item-status\.completed[\s\S]*--ds-success/);
  assert.match(styles, /thread-item-status\.failed[\s\S]*--ds-error/);
  // D450: the row shows the session title alone. The marker is pinned inside the
  // lane each row reserves on its own left edge, so it never trades width with
  // the title it labels and no locale word has to fit beside it — the state is
  // named by the marker's own tooltip and accessible name.
  assert.match(
    sidebar,
    /className="thread-item-main"[\s\S]*?\{status \? renderSessionStatus\(status\) : null\}/,
  );
  assert.doesNotMatch(sidebar, /renderSessionStatusChip|thread-item-status-chip/);
  assert.doesNotMatch(sidebar, /isAttentionStatus|thread-item-status-label/);
  assert.doesNotMatch(sidebar, /thread-item-preview|session\.lastMessage/);
  assert.doesNotMatch(sidebar, /nav\.sessionRunningShort|nav\.sessionNeedsInputShort/);
  assert.doesNotMatch(sidebar, /className="thread-item-title-row/);
  for (const locale of ["de", "en", "es", "fr", "ko", "tr", "zh-CN", "zh-TW"]) {
    const source = fs.readFileSync(
      new URL(`../../../packages/i18n/src/locales/${locale}/index.ts`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /sessionRunningShort|sessionNeedsInputShort/);
  }
  // The lane is the row button's own left padding, so the marker stays inside the
  // click target, and the list body no longer hangs its rows inside the project
  // block — the title column keeps the x it had before the marker existed.
  assert.match(styles, /--ds-sidebar-status-lane: 22px/);
  assert.doesNotMatch(styles, /--ds-sidebar-status-gap|--ds-sidebar-status-column/);
  assert.doesNotMatch(styles, /thread-item-status-chip|thread-item-status-label/);
  assert.doesNotMatch(styles, /\.thread-item-preview \{/);
  const mainRule = styles.match(/^\.thread-item-main \{[^}]*\}/m)?.[0] ?? "";
  assert.match(mainRule, /padding: 5px 6px 5px var\(--ds-sidebar-status-lane\)/);
  const dotRule = styles.match(/^\.thread-item-status \{[^}]*\}/m)?.[0] ?? "";
  assert.match(dotRule, /position: absolute/);
  assert.match(dotRule, /left: 0/);
  assert.match(dotRule, /width: var\(--ds-sidebar-status-lane\)/);
  const capsuleRule =
    styles.match(
      /^\.thread-item-status\.running::before,\n\.thread-item-status\.permission::before \{[^}]*\}/m,
    )?.[0] ?? "";
  assert.match(capsuleRule, /width: 16px/);
  assert.match(capsuleRule, /height: 8px/);
  assert.match(capsuleRule, /border-radius: var\(--radius-full\)/);
  assert.doesNotMatch(styles, /thread-item-main:has\(/);
  assert.match(
    styles,
    /prefers-reduced-motion: reduce[\s\S]*thread-item-status\.running::before[\s\S]*animation: none/,
  );
  assert.match(
    styles,
    /prefers-reduced-motion: reduce[\s\S]*thread-item-status\.permission::before[\s\S]*animation: none/,
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
