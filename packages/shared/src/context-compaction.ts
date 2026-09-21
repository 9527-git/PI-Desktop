import type {
  ContextCompactionMark,
  ContextCompactionRecord,
} from "./types.js";

/**
 * The generation counter rides inside the checkpoint's opaque `details` value:
 * the host persists that field verbatim, so it survives the transcript round
 * trip without a record schema change.
 */
export function checkpointGeneration(details: unknown): number {
  const value = (details as { generation?: unknown } | null | undefined)
    ?.generation;
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : 1;
}

/** Same four-characters-per-token heuristic the runtime uses for estimates. */
export function estimateSummaryTokens(summary: string): number {
  return Math.ceil(summary.length / 4);
}

/**
 * Whether the checkpoint's summary came from the model. The no-summary family
 * stamps `strategy: "fresh_window"` into the same opaque `details` value and
 * fills the summary with a fixed rollover marker instead.
 */
export function checkpointSummarized(details: unknown): boolean {
  const value = (details as { strategy?: unknown } | null | undefined)?.strategy;
  return value !== "fresh_window";
}

/**
 * Describe one checkpoint for its transcript row and the context inspector.
 * `tokensAfter` is the runtime's estimate of the request the compacted context
 * produces — the conversation plus the system prompt and tool schemas the
 * conversation-only estimate leaves out — and only exists on the live event that
 * installed the checkpoint; the durable record does not carry it, so a mark
 * rebuilt from storage leaves it out.
 */
export function contextCompactionMark(
  record: ContextCompactionRecord,
  tokensAfter?: number,
): ContextCompactionMark {
  const after =
    typeof tokensAfter === "number" &&
    Number.isFinite(tokensAfter) &&
    tokensAfter > 0
      ? Math.round(tokensAfter)
      : undefined;
  return {
    id: record.id,
    throughMessageId: record.throughMessageId,
    generation: checkpointGeneration(record.details),
    summaryTokens: estimateSummaryTokens(record.summary ?? ""),
    summarized: checkpointSummarized(record.details),
    tokensBefore: record.tokensBefore,
    ...(after === undefined ? {} : { tokensAfter: after }),
  };
}
