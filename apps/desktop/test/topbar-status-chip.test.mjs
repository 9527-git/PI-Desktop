import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { conversationStatus } from "../src/lib/conversation-status.ts";

const topbar = fs.readFileSync(
  new URL("../src/components/ConversationTopbar.tsx", import.meta.url),
  "utf8",
);
const chrome = fs.readFileSync(
  new URL("../src/styles/chrome.css", import.meta.url),
  "utf8",
);

test("a pending human decision outranks a running turn", () => {
  assert.equal(conversationStatus({ running: false }), null);
  assert.equal(conversationStatus({ running: true }), "running");
  assert.equal(
    conversationStatus({ running: true, hasPendingPermission: true }),
    "pending",
  );
  assert.equal(
    conversationStatus({ running: false, hasPendingAsk: true }),
    "pending",
  );
  assert.equal(
    conversationStatus({ running: true, hasPendingPlan: true }),
    "pending",
  );
});

test("an idle session with empty queues shows no chip", () => {
  assert.equal(
    conversationStatus({
      running: false,
      hasPendingPermission: false,
      hasPendingAsk: false,
      hasPendingPlan: false,
    }),
    null,
  );
});

test("the topbar reads all three intervention queues for the active session", () => {
  assert.match(topbar, /conversationStatus\(\{/);
  assert.match(topbar, /runningSessions\[activeSessionId\]/);
  assert.match(topbar, /pendingPermissions\[activeSessionId\]/);
  assert.match(topbar, /pendingAsks\[activeSessionId\]/);
  assert.match(topbar, /pendingPlans\[activeSessionId\]\?\.status === "pending"/);
});

test("the chip renders left of the title inside the draggable title band", () => {
  assert.match(topbar, /className="ct-status-slot"/);
  assert.match(topbar, /data-state={status \?\? "hidden"}/);
  assert.match(topbar, /role="status"/);
  assert.match(
    topbar,
    /ct-status-slot[\s\S]*ct-status-chip[\s\S]*ct-status-dot[\s\S]*ct-title/,
  );
  assert.match(topbar, /chat\.topbarStatusRunning/);
  assert.match(topbar, /chat\.topbarStatusPending/);
  // Non-interactive: the chip slice adds no click target and no tooltip.
  const chipSlice =
    topbar.match(
      /className="ct-status-slot"[\s\S]*?className="ct-title"/,
    )?.[0] ?? "";
  assert.match(chipSlice, /ct-status-dot/);
  assert.doesNotMatch(chipSlice, /onClick|TooltipButton|<button/);
});

test("the chip mirrors the sidebar dot language and honors reduced motion", () => {
  assert.match(
    chrome,
    /\.ct-status-slot \{[\s\S]*?max-width: 0;[\s\S]*?opacity: 0;[\s\S]*?transition: max-width var\(--motion-duration-normal\) var\(--motion-ease-out\)/,
  );
  assert.match(
    chrome,
    /\.ct-status-slot\[data-state="running"\],\s*\n\.conversation-topbar \.ct-status-slot\[data-state="pending"\] \{[\s\S]*?max-width: 200px;[\s\S]*?opacity: 1;/,
  );
  assert.match(
    chrome,
    /\.ct-status-chip\.ct-status-running \{[\s\S]*?var\(--ds-warning\)/,
  );
  assert.match(
    chrome,
    /\.ct-status-chip\.ct-status-pending \{[\s\S]*?var\(--ds-purple\)/,
  );
  assert.match(
    chrome,
    /\.ct-status-chip\.ct-status-running \.ct-status-dot \{[\s\S]*?animation: ct-status-breathe 1\.6s ease-in-out infinite;/,
  );
  assert.match(
    chrome,
    /\.ct-status-chip\.ct-status-pending \.ct-status-dot \{[\s\S]*?animation: ct-status-pulse 1\.2s ease-in-out infinite;/,
  );
  assert.match(chrome, /@keyframes ct-status-breathe \{/);
  assert.match(chrome, /@keyframes ct-status-pulse \{/);
  assert.match(
    chrome,
    /prefers-reduced-motion: reduce\)[\s\S]*?\.ct-status-slot \{[^}]*transition: none;/,
  );
  // The reduced-motion dot rule must carry the same running/pending classes as
  // the animation rules, or it loses on specificity and the dot keeps moving.
  assert.match(
    chrome,
    /prefers-reduced-motion: reduce\)[\s\S]*?\.ct-status-chip\.ct-status-running \.ct-status-dot,\s*\.conversation-topbar \.ct-status-chip\.ct-status-pending \.ct-status-dot \{[^}]*animation: none;/,
  );
});
