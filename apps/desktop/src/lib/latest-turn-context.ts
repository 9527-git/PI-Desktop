import type {
  ContextCompactionMark,
  MessageUsage,
  ModelInfo,
  ProviderPublic,
  UiMessage,
} from "@pi-desktop/shared";
import {
  assistantTurnResponseDuration,
  assistantTurnResponseOutputIsEstimated,
  assistantTurnResponseOutputTokens,
  assistantTurnTools,
  assistantTurnUsage,
  buildTranscriptEntries,
  type AssistantTurnEntry,
} from "./assistant-turns";
import {
  latestMessageUsage,
  postCompactionOccupancy,
  resolveContextWindow,
} from "./context-usage";

export type LatestTurnContextInspector = {
  usage: MessageUsage;
  turnUsage: MessageUsage;
  contextWindow: number;
  tools: UiMessage[];
  responseDurationMs?: number;
  responseOutputTokens?: number;
  responseOutputEstimated: boolean;
  /**
   * The newest checkpoint's post-compaction occupancy, while no request has
   * reported usage past it. The ring leads with it so a compaction shows at
   * once instead of waiting for the next turn to answer.
   */
  postCompactionOccupancy?: number;
};

/**
 * The composer inspector always mirrors the newest assistant turn that
 * reported usage, so a later streaming turn without totals does not steal
 * the previous ring's tools or throughput.
 */
export function latestTurnContextInspector(
  messages: UiMessage[],
  providerModels: Record<string, ModelInfo[]>,
  providers: ProviderPublic[],
  compactions: readonly ContextCompactionMark[] = [],
): LatestTurnContextInspector | undefined {
  // Delegate rows carry their own usage; remaining capacity is a parent-session
  // number, so those snapshots must not steal the composer ring.
  const parentMessages = messages.filter((message) => !message.parentToolCallId);
  const latestUsage = latestMessageUsage(parentMessages);
  if (!latestUsage) return undefined;

  const turns = buildTranscriptEntries(messages, compactions).entries.filter(
    (entry): entry is AssistantTurnEntry => entry.kind === "assistant-turn",
  );
  const latestTurn =
    [...turns].reverse().find((turn) => assistantTurnUsage(turn)) ??
    turns.at(-1);
  const latestUsageMessage = [...parentMessages]
    .reverse()
    .find((message) => message.usage);

  const occupancyAfterCompaction = postCompactionOccupancy(
    parentMessages,
    compactions,
  );

  return {
    // Occupancy and provider cache/input/output use this last request.
    // turnUsage remains the visual-turn sum for completed-turn speed.
    usage: latestUsage,
    ...(occupancyAfterCompaction === undefined
      ? {}
      : { postCompactionOccupancy: occupancyAfterCompaction }),
    turnUsage:
      (latestTurn ? assistantTurnUsage(latestTurn) : undefined) ?? latestUsage,
    contextWindow: resolveContextWindow(
      latestUsageMessage?.providerId,
      latestUsageMessage?.modelId,
      providerModels,
      providers,
    ),
    tools: latestTurn ? assistantTurnTools(latestTurn) : [],
    responseDurationMs: latestTurn
      ? assistantTurnResponseDuration(latestTurn)
      : undefined,
    responseOutputTokens: latestTurn
      ? assistantTurnResponseOutputTokens(latestTurn)
      : undefined,
    responseOutputEstimated: latestTurn
      ? assistantTurnResponseOutputIsEstimated(latestTurn)
      : false,
  };
}
