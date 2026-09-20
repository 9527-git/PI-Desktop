import {
  readStoreSource,
  readTranscriptModule,
  readTranscriptSource,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  store,
  transcript,
  retryPopover,
  messagesStyles,
  proseStyles,
  en,
  zh,
  assistantTurns,
  runtime,
  taskList,
] = await Promise.all([
  readStoreSource(),
  readTranscriptSource(),
  readTranscriptModule("RetryErrorPopover.tsx"),
  read("../src/styles/messages.css"),
  read("../src/styles/prose.css"),
  read("../../../packages/i18n/src/locales/en/index.ts"),
  read("../../../packages/i18n/src/locales/zh-CN/index.ts"),
  read("../src/lib/assistant-turns.ts"),
  read("../../../packages/agent-runtime/src/runtime.ts"),
  read("../../../packages/agent-runtime/src/task-list.ts"),
]);

test("active turns show immediate and phase-specific feedback in the transcript", () => {
  assert.match(transcript, /function WorkingIndicator\(/);
  assert.match(transcript, /data-testid="working-indicator"/);
  assert.match(transcript, /role="status"/);
  assert.match(transcript, /className="working-indicator-mark" aria-hidden="true"/);
  assert.match(transcript, /className="working-indicator-label"/);
  assert.match(transcript, /function RunActivityIndicator\(/);
  assert.match(transcript, /data-testid="run-activity-indicator"/);
  assert.doesNotMatch(transcript, /tool-activity-current|currentStatus|activityItemStatus/);
  assert.match(transcript, /waiting-model/);
  assert.match(transcript, /waitingForSubagents/);
  assert.match(transcript, /waitingForSubagentNamed/);
  assert.match(transcript, /startingTurn/);
  assert.match(transcript, /preparingNextRequest/);
  assert.match(transcript, /compactingContext/);
  assert.match(transcript, /recoveringTurn/);
  assert.match(transcript, /retryingModel/);
  assert.match(transcript, /function runActivityLabel\(/);
  assert.match(transcript, /activity\.error/);
  assert.match(transcript, /run-activity-error-popover message-error/);
  assert.match(transcript, /role="tooltip"/);
  assert.match(retryPopover, /createPortal\([\s\S]*document\.body/);
  assert.match(retryPopover, /aria-describedby=\{detailsId\}/);
  assert.match(retryPopover, /aria-label=\{description\}/);
  assert.match(retryPopover, /onPointerEnter=\{\(\) => setOpen\(true\)\}/);
  assert.match(retryPopover, /onFocus=\{\(\) => setOpen\(true\)\}/);
  assert.match(transcript, /state\.agentStatuses\[sessionId\]\?\.activity/);
  assert.match(transcript, /const specializedActivity = agentActivity/);
  assert.match(transcript, /!hasSpecializedActivity/);
  assert.match(transcript, /const showWorking =/);
  assert.match(transcript, /\{showWorking \? <WorkingIndicator \/> : null\}/);
  assert.match(transcript, /function PlanningIndicator\(/);
  assert.match(transcript, /data-testid="planning-indicator"/);
  assert.match(transcript, /const showPlanning =/);
  assert.match(transcript, /\{showPlanning \? <PlanningIndicator kind=\{planningKind\} \/> : null\}/);
  assert.match(
    transcript,
    /planningState === "planning"[\s\S]*!activeToolGroup[\s\S]*!assistantIsAnswering/,
  );
  const planningBlock =
    transcript.match(/function PlanningIndicator\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(planningBlock, /working-indicator-mark/);
  assert.doesNotMatch(planningBlock, /IconListChecks|IconTarget/);
  assert.match(messagesStyles, /\.planning-state-indicator\s*\{/);
  assert.match(
    messagesStyles,
    /\.planning-state-indicator[\s\S]*?animation:\s*planning-state-in/,
  );
  assert.match(
    messagesStyles,
    /\.planning-state-indicator \.working-indicator-mark > span\s*\{[\s\S]*?background:\s*var\(--ds-purple\)/,
  );
  assert.doesNotMatch(transcript, /AgentProgressTimeline|agent-progress/);
  assert.match(transcript, /<PermissionCard/);
  assert.doesNotMatch(store, /AgentProgress|agentProgress|updateAgentProgress/);
  assert.match(messagesStyles, /\.working-indicator\s*\{/);
  assert.doesNotMatch(messagesStyles, /\.tool-activity-current/);
  assert.match(messagesStyles, /\.working-indicator-mark\s*\{/);
  assert.match(messagesStyles, /\.run-activity-indicator\[data-phase="waiting-model"\]/);
  assert.match(messagesStyles, /\.run-activity-indicator\[data-phase="compacting"\]/);
  assert.match(messagesStyles, /\.run-activity-indicator\[data-phase="recovering"\]/);
  assert.match(messagesStyles, /\.run-activity-indicator\[data-phase="retrying"\]/);
  assert.match(
    messagesStyles,
    /\.run-activity-error-popover\.message-error\s*\{[\s\S]*?position:\s*fixed/,
  );
  assert.match(
    messagesStyles,
    /\.run-activity-error-popover\.message-error\s*\{[\s\S]*?background:\s*color-mix\([^;]*--ds-bg-elevated-opaque/,
  );
  assert.match(
    messagesStyles,
    /\.run-activity-error-popover\.message-error\.is-open\s*\{[\s\S]*?visibility:\s*visible/,
  );
  assert.doesNotMatch(messagesStyles, /\.run-activity-retry-reason:hover\s+\.run-activity-error-popover/);
  assert.match(messagesStyles, /\.run-activity-indicator\[data-phase="waiting-subagents"\]/);
  assert.match(messagesStyles, /\.working-indicator-mark > span\s*\{[\s\S]*?animation:\s*working-indicator-dot\s+1s/);
  assert.doesNotMatch(proseStyles, /\.working-indicator\s*\{|\.shimmer-text\s*\{/);
  assert.doesNotMatch(messagesStyles, /\.shimmer-text\s*\{|animation:\s*shimmer\b/);
  assert.match(
    messagesStyles,
    /\.tool-activity-label\.running::after,\s*\.tool-row-name\.running::after\s*\{[\s\S]*?animation:\s*activity-marker-pulse\s+1s/,
  );
  assert.doesNotMatch(
    en,
    /progressUnderstanding|progressWorking|progressChecking|progressFinalizing|progressWaiting/,
  );
  assert.doesNotMatch(
    zh,
    /progressUnderstanding|progressWorking|progressChecking|progressFinalizing|progressWaiting/,
  );
  for (const catalog of [en, zh]) {
    assert.match(catalog, /waitingForModel:/);
    assert.match(catalog, /startingTurn:/);
    assert.match(catalog, /preparingNextRequest:/);
    assert.match(catalog, /compactingContext:/);
    assert.match(catalog, /recoveringTurn:/);
    assert.match(catalog, /retryingModel:/);
    assert.match(catalog, /waitingForSubagentNamed:/);
    assert.match(catalog, /waitingForSubagents_one:/);
    assert.match(catalog, /waitingForSubagents_other:/);
  }
  assert.match(store, /agentStatuses: Record<string, AgentStatus>/);
  assert.match(store, /event\.type === "status"/);
});

/* ADR 0260 gives the running turn one persistent surface, and what it lists is
 * the agent's own declaration rather than a guess. These assertions pin the
 * tool the model calls and the declaration's transcript shape; the card's own
 * surface contract lives in turn-progress-surface.test.mjs (ADR 0261). */
test("the agent declares its task list with a tool, not a guessable heuristic", () => {
  assert.match(
    taskList,
    /export const UPDATE_TASKS_TOOL_NAME = "UpdateTasks"/,
  );
  assert.match(taskList, /export function buildUpdateTasksTool\(\): AgentTool/);
  // A declaration is a report, so it takes no permission and reaches no host:
  // the whole tool lives in the sidecar and rides the ordinary tool-call events.
  assert.doesNotMatch(taskList, /host\.|RuntimeHost|invoke\(|beforeToolCall/);
  assert.match(taskList, /MAX_UPDATE_TASKS_ITEMS = 24/);
  assert.match(taskList, /export const UPDATE_TASKS_PROMPT = `## Task list/);

  assert.match(
    runtime,
    /import \{[\s\S]*?buildUpdateTasksTool,[\s\S]*?UPDATE_TASKS_PROMPT,[\s\S]*?UPDATE_TASKS_TOOL_NAME[\s\S]*?\} from "\.\/task-list\.js"/,
  );
  // Core set: a list the model has to go looking for with ToolSearch is a list
  // it will not keep updated, and a stale card is worse than no card.
  assert.match(
    runtime,
    /const AGENT_CORE_TOOL_NAMES = new Set\(\[[\s\S]*?UPDATE_TASKS_TOOL_NAME,/,
  );
  assert.match(
    runtime,
    /const taskListTools =\s*this\.mode === "agent" \? \[buildUpdateTasksTool\(\)\] : \[\];/,
  );
  assert.match(runtime, /\.\.\.taskListTools,/);
  assert.match(
    runtime,
    /\.\.\.\(this\.mode === "agent" \? \[UPDATE_TASKS_PROMPT\] : \[\]\)/,
  );
});

test("a declaration owns its turn without becoming a transcript row", () => {
  assert.match(assistantTurns, /export function isTaskListTool\(/);
  assert.match(assistantTurns, /taskDeclarations\?: UiMessage\[\]/);
  // It streams (so it opens its turn and orders the rows around it) but leaves
  // `visible`, which the minimap reads as mounted targets.
  assert.match(
    assistantTurns,
    /const streamed = messages\.filter\([\s\S]*?isTaskListTool\(message\.toolName\)/,
  );
  assert.match(
    assistantTurns,
    /const visible = streamed\.filter\([\s\S]*?isTaskListTool\(message\.toolName\)/,
  );
  assert.match(assistantTurns, /for \(const message of streamed\) \{/);
  assert.match(assistantTurns, /current\.taskDeclarations = declarations;/);
  // Identity survives a rebuild: the array is fresh every pass, so the reuse
  // comparator has to read it by content or every token re-renders the card.
  assert.match(assistantTurns, /function taskDeclarationsEqual\(/);
});
