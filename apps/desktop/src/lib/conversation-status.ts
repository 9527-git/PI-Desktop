export type ConversationStatus = "pending" | "running";

/**
 * The conversation surface orders its states by "who is the turn waiting on":
 * an agent blocked on a human decision needs the user, a running agent only
 * needs time, so pending outranks running. The sidebar keeps its own
 * permission-only rule (D135); the chip widens the pending set to every
 * intervention source instead.
 */
export function conversationStatus({
  running,
  hasPendingPermission,
  hasPendingAsk,
  hasPendingPlan,
}: {
  running: boolean;
  hasPendingPermission?: boolean;
  hasPendingAsk?: boolean;
  hasPendingPlan?: boolean;
}): ConversationStatus | null {
  if (hasPendingPermission || hasPendingAsk || hasPendingPlan) return "pending";
  if (running) return "running";
  return null;
}
