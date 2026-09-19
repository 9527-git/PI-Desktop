import type { UiMessage } from "@pi-desktop/shared";
import { assistantTurnTools, type AssistantTurnEntry } from "./assistant-turns.ts";
import { getToolSummary } from "./tool-display.ts";
import {
  reviewChangesFromMessages,
  summarizeReviewChanges,
} from "./workspace-review.ts";

/**
 * Step rows the card lists before folding older ones into one line. It is a
 * locator for where the turn stands, not a second transcript, so it shows the
 * tail it can render without measuring — and a 24-step declared list still fits
 * over the live rows it is supposed to accompany.
 */
export const TURN_PROGRESS_VISIBLE_STEPS = 8;

export type TurnProgressStatus = "pending" | "active" | "done" | "error";

export type TurnProgressStep = {
  id: string;
  label: string;
  status: TurnProgressStatus;
};

export type TurnProgress = {
  /** Turn start used for the elapsed timer, on the transcript's own clock. */
  startedAt: number;
  /** Whether the steps are the agent's declared list or its observed rows. */
  declared: boolean;
  /** Rows in the list: declared steps, or the tool rows this turn has run. */
  steps: number;
  /** Rows finished: declared `completed`, or tool rows that returned. */
  completed: number;
  /** Newest rows last, capped at {@link TURN_PROGRESS_VISIBLE_STEPS}. */
  visible: TurnProgressStep[];
  earlierSteps: number;
  /** The step the turn is on now, for the collapsed card's action slot. */
  activeLabel: string;
  filesChanged: number;
  additions: number;
  deletions: number;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The declared status, read the same way the sidecar reads it (ADR 0260). The
 * arguments are model-authored JSON that crossed a persistence boundary, so
 * neither side may assume the other's normalization happened.
 */
function declaredStatus(value: unknown): TurnProgressStatus {
  const key = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (key.startsWith("completed") || key.startsWith("done") || key === "finished")
    return "done";
  if (key.startsWith("inprogress") || key.startsWith("active") || key.startsWith("doing"))
    return "active";
  return "pending";
}

function taskStatus(message: UiMessage): TurnProgressStatus {
  switch (message.toolStatus) {
    case "success":
      return "done";
    case "error":
    case "denied":
      return "error";
    default:
      return "active";
  }
}

/**
 * The list the agent said it is working through, newest declaration winning:
 * the tool replaces the whole list, so an earlier call is a stale plan rather
 * than a prefix of the current one. A declaration whose arguments the renderer
 * cannot read falls back to the tool rows, because a card that disappears on a
 * malformed call is worse than a card that says less.
 */
function declaredSteps(entry: AssistantTurnEntry): TurnProgressStep[] | null {
  const latest = entry.taskDeclarations?.at(-1);
  if (!latest) return null;
  const args = recordValue(latest.toolArgs);
  const raw = Array.isArray(args?.tasks)
    ? args.tasks
    : Array.isArray(recordValue(recordValue(latest.toolResult)?.details)?.tasks)
      ? (recordValue(recordValue(latest.toolResult)?.details)?.tasks as unknown[])
      : null;
  if (!raw) return null;
  const steps = raw.flatMap((item, index): TurnProgressStep[] => {
    const record = typeof item === "string" ? { title: item } : recordValue(item);
    if (!record) return [];
    const label = [record.title, record.content, record.description]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find(Boolean);
    if (!label) return [];
    return [
      {
        id: `${latest.id}:${index}`,
        label,
        status: declaredStatus(record.status ?? record.state),
      },
    ];
  });
  return steps.length > 0 ? steps : null;
}

/**
 * The turn's first known timestamp, which is what the inline activity group
 * already uses as its start. A turn that has not produced a row yet reports
 * `now`, so the card never shows a timer counting from the app's launch.
 */
function turnStartedAt(entry: AssistantTurnEntry, now: number): number {
  for (const part of entry.parts) {
    const createdAt =
      part.kind === "message"
        ? part.message.createdAt
        : part.items[0]?.message.createdAt;
    const startedAt = Date.parse(createdAt ?? "");
    if (Number.isFinite(startedAt)) return startedAt;
  }
  return now;
}

/**
 * What this turn has done and how far along it is.
 *
 * Two sources, one shape. When the agent declared a task list the card reports
 * that, because it is the only surface that knows the denominator; when it did
 * not, the card degrades to the rows the turn actually produced, which is the
 * same evidence the finished-turn summary and the transcript already show.
 * Nothing here is estimated, and nothing here reads the transcript's DOM.
 */
export function turnProgress(
  entry: AssistantTurnEntry | null,
  now = Date.now(),
): TurnProgress | null {
  if (!entry) return null;
  const tools = assistantTurnTools(entry);
  const declared = declaredSteps(entry);
  const steps =
    declared ??
    tools.map((message) => ({
      id: message.id,
      label: getToolSummary(message.toolName, message.toolArgs),
      status: taskStatus(message),
    }));
  const visible = steps.slice(-TURN_PROGRESS_VISIBLE_STEPS);
  const changes = summarizeReviewChanges(reviewChangesFromMessages(tools));
  const active =
    declared?.find((step) => step.status === "active") ??
    [...(declared ?? [])].reverse().find((step) => step.status === "pending");
  return {
    startedAt: turnStartedAt(entry, now),
    declared: declared !== null,
    steps: steps.length,
    completed: steps.reduce(
      (total, step) => total + (step.status === "done" ? 1 : 0),
      0,
    ),
    visible,
    earlierSteps: steps.length - visible.length,
    activeLabel:
      active?.label ??
      (tools.length > 0
        ? getToolSummary(
            tools[tools.length - 1].toolName,
            tools[tools.length - 1].toolArgs,
          )
        : ""),
    filesChanged: changes.changeCount,
    additions: changes.additions,
    deletions: changes.deletions,
  };
}
