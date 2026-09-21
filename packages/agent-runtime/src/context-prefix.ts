/**
 * Tokens a request carries outside its message list: the system prompt and the
 * active tool schemas.
 *
 * `estimateContextTokens` answers with provider usage only while a
 * usage-bearing assistant message survives in the conversation. A checkpoint
 * replaces everything before its boundary with a summary message, which is not
 * an assistant message, so the compacted context is estimated from characters
 * alone — and that estimate covers the conversation and nothing else, while the
 * figure it replaces came from a real request that also carried the prefix.
 * Comparing the two made an ordinary compaction read as an empty window, so the
 * post-compaction occupancy reported to the composer ring adds the prefix back.
 *
 * Deliberately dependency-light: this is the same four-characters-per-token
 * heuristic the rest of the runtime and the renderer already use, and it needs
 * nothing but the two inputs.
 */

const CHARS_PER_TOKEN = 4;

/** Estimated tokens for one text block using the runtime's character heuristic. */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Tool schemas are sent as JSON. Functions on a tool definition (its executor)
 * are not part of the payload and `JSON.stringify` drops them, which is exactly
 * the part that must not be counted.
 */
function serialized(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

/**
 * Estimated tokens the system prompt and the active tool schemas add to every
 * request. Absent inputs contribute nothing rather than throwing: a runtime
 * that has not composed its prompt yet must still be able to report a budget.
 */
export function contextPrefixTokens(
  systemPrompt: string | undefined,
  tools: readonly unknown[] | undefined,
): number {
  const prompt =
    typeof systemPrompt === "string" ? estimateTextTokens(systemPrompt) : 0;
  const schemas =
    tools && tools.length > 0 ? estimateTextTokens(serialized(tools)) : 0;
  return prompt + schemas;
}
