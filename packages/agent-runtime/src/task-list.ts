/**
 * The `UpdateTasks` tool: the agent's own declaration of the steps it is
 * working through (ADR 0260).
 *
 * The transcript already shows every tool call (ADR 0175), but forty rows of
 * them do not tell the user how much of the job is left. This tool lets the
 * model state the plan it is executing and keep it updated, so the turn
 * progress card can show a real `N / M` instead of an invented percentage.
 *
 * Two boundaries keep it cheap and safe:
 * - It is a declaration, not a contract. It never gates the turn, asks no
 *   permission, and runs entirely in the sidecar: nothing reaches host-core,
 *   no IPC channel, no schema version.
 * - It is not persisted state of its own. The list lives in the tool call, so
 *   the session transcript is its only record and a resumed session still
 *   renders the same card from the same rows.
 *
 * The list is replaced whole on every call. A patch language would cost schema
 * the model gets wrong and buys nothing at this size.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

export const UPDATE_TASKS_TOOL_NAME = "UpdateTasks";

/**
 * Beyond this the list is no longer a progress summary, and the model is
 * writing a plan document instead of steering a turn.
 */
export const MAX_UPDATE_TASKS_ITEMS = 24;

export type TaskListStatus = "pending" | "in_progress" | "completed";

export type TaskListItem = {
  title: string;
  status: TaskListStatus;
};

/** Tool results and transcript rows both carry free-form model output. */
function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The status the model meant, not the status it typed. Providers drift across
 * `done`, `complete`, `in progress`, and a lost step marker costs the user a
 * wrong count, so the read is lenient and the write above is strict.
 */
function normalizeStatus(value: unknown): TaskListStatus {
  const key = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!key) return "pending";
  if (key.startsWith("completed") || key.startsWith("done") || key === "finished")
    return "completed";
  if (key.startsWith("inprogress") || key.startsWith("active") || key.startsWith("doing"))
    return "in_progress";
  return "pending";
}

/**
 * The declared list, in order, or `null` when the call carried nothing usable.
 * Titles are trimmed and empty steps dropped: an empty row on the card reads as
 * a step the model lost, not as a step with no name.
 */
export function normalizeTaskList(raw: unknown): TaskListItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: TaskListItem[] = [];
  for (const entry of raw) {
    const record =
      typeof entry === "string"
        ? { title: entry }
        : recordValue(entry);
    if (!record) continue;
    const title = [record.title, record.content, record.description]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find(Boolean);
    if (!title) continue;
    items.push({
      title: title.slice(0, 200),
      status: normalizeStatus(record.status ?? record.state),
    });
    if (items.length >= MAX_UPDATE_TASKS_ITEMS) break;
  }
  return items.length > 0 ? items : null;
}

export function formatTaskListResult(items: TaskListItem[]): string {
  const completed = items.filter((item) => item.status === "completed").length;
  const lines = items.map((item, index) => {
    const marker =
      item.status === "completed"
        ? "[x]"
        : item.status === "in_progress"
          ? "[>]"
          : "[ ]";
    return `${index + 1}. ${marker} ${item.title}`;
  });
  return [
    `Task list updated: ${completed} of ${items.length} steps completed.`,
    ...lines,
    "Call UpdateTasks again with the whole list whenever a step starts or finishes.",
  ].join("\n");
}

/** Steering for the agent-mode system prompt (ADR 0260). */
export const UPDATE_TASKS_PROMPT = `## Task list
For any request that takes more than a few tool calls, call UpdateTasks first with the ordered steps you intend to work through, then call it again the moment a step starts and the moment it finishes — the whole list each time, with every step's current status. The user watches this list as the turn's progress card, so a step left \`in_progress\` after you moved on, or a list you never update, tells them something false. Keep one short line per step, write the steps in the language the user writes in, and mark a step \`completed\` only after its work and its verification are actually done. Skip it for a single answer or a one-or-two-call fix.`;

export function buildUpdateTasksTool(): AgentTool {
  return {
    name: UPDATE_TASKS_TOOL_NAME,
    label: "Update task list",
    description:
      "Declare the ordered steps of the user's current request and keep them current. " +
      "The whole list is replaced on every call, so pass every step each time in its order with its status " +
      "(`pending`, `in_progress`, `completed`). Use it for any request that takes more than a few tool calls; " +
      "one short line per step, in the user's language, and never mark a step completed before its work and its " +
      "verification are done. This drives the user's progress card: it does not gate execution and needs no permission.",
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          title: Type.String({
            description: "One short imperative line describing this step.",
          }),
          status: Type.Optional(
            Type.String({
              description: "pending | in_progress | completed. Defaults to pending.",
            }),
          ),
        }),
        { maxItems: MAX_UPDATE_TASKS_ITEMS },
      ),
    }),
    executionMode: "sequential" as const,
    execute: async (_toolCallId: string, params: unknown) => {
      const items = normalizeTaskList(recordValue(params)?.tasks);
      if (!items) {
        return {
          content: [
            {
              type: "text",
              text: `${UPDATE_TASKS_TOOL_NAME} needs a non-empty \`tasks\` array, each item with a \`title\` and an optional \`status\`.`,
            },
          ],
          details: { errorCode: "UPDATETASKS_INVALID_ARGUMENT" },
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: formatTaskListResult(items) }],
        details: { tasks: items },
      };
    },
  };
}
