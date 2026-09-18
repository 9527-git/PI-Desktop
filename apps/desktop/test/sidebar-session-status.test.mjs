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
  // D446: running and needs-input rows carry their word inside the SAME tinted
  // chip as the dot, so the word can never drift onto the title line of a
  // two-line row; quiet states keep the plain dot in the left gutter.
  assert.match(
    sidebar,
    /isAttentionStatus\(status\)[\s\S]*thread-item-status-chip[\s\S]*renderSessionStatus\(status\)[\s\S]*thread-item-status-label/,
  );
  assert.match(
    sidebar,
    /!isAttentionStatus\(status\)[\s\S]{0,80}renderSessionStatus\(status\)/,
  );
  assert.match(sidebar, /className="thread-item-status-label" aria-hidden/);
  assert.doesNotMatch(sidebar, /thread-item-title-row/);
  assert.match(styles, /thread-item-status-chip\.running[\s\S]*--ds-warning/);
  assert.match(styles, /thread-item-status-chip\.permission[\s\S]*--ds-purple/);
  assert.match(
    styles,
    /thread-item-status-chip \.thread-item-status \{[\s\S]*?position: static/,
  );
  assert.match(
    styles,
    /thread-item-main:has\(\.thread-item-status-chip\)[\s\S]*?padding-left: 6px/,
  );
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
