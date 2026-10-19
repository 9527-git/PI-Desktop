/**
 * Native taskbar/Dock status badge contract (D473).
 *
 * The renderer owns the live session state; Main only paints the aggregate on
 * the native surface. Keeping the aggregation here makes the priority one
 * tested contract instead of a renderer-side ad hoc expression.
 */

export const TASKBAR_STATUS_KINDS = [
  "running",
  "attention",
  "failed",
  "completed",
] as const;

export type TaskbarStatusKind = (typeof TASKBAR_STATUS_KINDS)[number];

export type TaskbarStatusSnapshot =
  | { kind: "none"; count: 0 }
  | { kind: TaskbarStatusKind; count: number };

export type TaskbarStatusSource = {
  runningSessions: Record<string, boolean>;
  pendingPermissions: Record<string, readonly unknown[]>;
  pendingAsks: Record<string, readonly unknown[]>;
  pendingPlans: Record<string, { status?: string } | undefined>;
  sessionOutcomes: Record<string, "completed" | "failed" | undefined>;
};

function trueKeys(map: Record<string, boolean>): Set<string> {
  const keys = new Set<string>();
  for (const [id, value] of Object.entries(map)) {
    if (value === true) keys.add(id);
  }
  return keys;
}

function nonEmptyKeys(map: Record<string, readonly unknown[]>): Set<string> {
  const keys = new Set<string>();
  for (const [id, value] of Object.entries(map)) {
    if (Array.isArray(value) && value.length > 0) keys.add(id);
  }
  return keys;
}

/**
 * Aggregate one native badge over every session.
 *
 * Priority is `attention > running > failed > completed`: a blocked agent is
 * the only state that needs a human, so it outranks mere work. Each session
 * contributes to exactly one bucket, so the count in the description never
 * double-counts a session that is both running and waiting on a permission.
 */
export function resolveTaskbarStatus(
  source: TaskbarStatusSource,
): TaskbarStatusSnapshot {
  const running = trueKeys(source.runningSessions);
  const attention = new Set<string>([
    ...nonEmptyKeys(source.pendingPermissions),
    ...nonEmptyKeys(source.pendingAsks),
  ]);
  for (const [id, plan] of Object.entries(source.pendingPlans)) {
    if (plan?.status === "pending") attention.add(id);
  }

  let attentionCount = 0;
  for (const id of attention) {
    attentionCount += 1;
    running.delete(id);
  }
  if (attentionCount > 0) {
    return { kind: "attention", count: attentionCount };
  }

  let runningCount = 0;
  for (const id of running) {
    runningCount += 1;
  }
  if (runningCount > 0) {
    return { kind: "running", count: runningCount };
  }

  let failedCount = 0;
  let completedCount = 0;
  for (const [id, outcome] of Object.entries(source.sessionOutcomes)) {
    if (outcome === "failed") failedCount += 1;
    else if (outcome === "completed") completedCount += 1;
  }
  if (failedCount > 0) {
    return { kind: "failed", count: failedCount };
  }
  if (completedCount > 0) {
    return { kind: "completed", count: completedCount };
  }
  return { kind: "none", count: 0 };
}

/** True when a value is one of the native badge kinds. */
export function isTaskbarStatusKind(value: unknown): value is TaskbarStatusKind {
  return (
    typeof value === "string" &&
    (TASKBAR_STATUS_KINDS as readonly string[]).includes(value)
  );
}

/** True when a wire value is a well-formed aggregate badge snapshot. */
export function isTaskbarStatusSnapshot(
  value: unknown,
): value is TaskbarStatusSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { kind?: unknown; count?: unknown };
  if (typeof candidate.count !== "number") return false;
  if (!Number.isInteger(candidate.count) || candidate.count < 0 || candidate.count > 999) {
    return false;
  }
  if (candidate.kind === "none") return candidate.count === 0;
  return isTaskbarStatusKind(candidate.kind) && candidate.count >= 1;
}
