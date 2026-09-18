import type { AppNotification } from "@pi-desktop/shared";

export type SidebarSessionStatus =
  | "running"
  | "selected"
  | "completed"
  | "failed"
  | "permission";
export type SidebarSessionOutcome = Extract<
  SidebarSessionStatus,
  "completed" | "failed"
>;

export function latestSessionOutcomes(
  notifications: AppNotification[],
): Record<string, SidebarSessionOutcome> {
  const outcomes: Record<string, SidebarSessionOutcome> = {};
  const seen = new Set<string>();

  // The host and renderer both keep notifications newest-first, so the first
  // entry per session is its latest terminal result. The badge means "a result
  // you have not looked at yet": once the notification is read — opening the
  // conversation reads it — the session gets no indicator at all.
  for (const notification of notifications) {
    if (seen.has(notification.sessionId)) continue;
    seen.add(notification.sessionId);
    if (notification.readAt) continue;
    outcomes[notification.sessionId] =
      notification.kind === "task.failed" ? "failed" : "completed";
  }

  return outcomes;
}

export function sidebarSessionStatus({
  running,
  selected,
  outcome,
  hasPendingPermission,
  hasPendingAsk,
  hasPendingPlan,
}: {
  running: boolean;
  selected: boolean;
  outcome?: "completed" | "failed";
  hasPendingPermission?: boolean;
  hasPendingAsk?: boolean;
  hasPendingPlan?: boolean;
}): SidebarSessionStatus | null {
  // "permission" is the stable id/class for the needs-input state (D135); D444
  // widens its predicate to the union of every intervention that blocks the
  // agent on a human: a permission prompt, a free-form ask, or a Plan/Goal
  // approval. The dot pulses purple until the user acts.
  if (hasPendingPermission || hasPendingAsk || hasPendingPlan) return "permission";
  if (running) return "running";
  if (selected) return "selected";
  return outcome ?? null;
}
