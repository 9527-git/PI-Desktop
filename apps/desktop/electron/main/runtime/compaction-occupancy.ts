/**
 * Sessions the main process is holding for an in-flight manual compaction.
 *
 * A manual `/compact` occupies the runtime for as long as its RPC is in flight:
 * the sidecar reports `isRunning` and rejects a prompt with `AGENT_BUSY`. That
 * window registers no turn, so the turn maps alone cannot see it, and the queue
 * would start a prompt against a busy runtime instead of waiting behind it.
 *
 * Exactly one main process owns the sidecar, so the registry is process-wide.
 * It is reference counted, and every hold returns its own idempotent release, so
 * overlapping compactions can never release each other's hold.
 */
const holds = new Map<string, number>();

/**
 * Mark a session as occupied by a manual compaction and return the release the
 * caller must run in a `finally`, whatever the compaction answers.
 */
export function holdCompactionSession(sessionId: string): () => void {
  const id = sessionId.trim();
  if (!id) return () => {};
  holds.set(id, (holds.get(id) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (holds.get(id) ?? 1) - 1;
    if (remaining > 0) holds.set(id, remaining);
    else holds.delete(id);
  };
}

/** True while a manual compaction still occupies the session. */
export function isCompactionOccupied(sessionId: string): boolean {
  const id = sessionId.trim();
  return id.length > 0 && holds.has(id);
}
