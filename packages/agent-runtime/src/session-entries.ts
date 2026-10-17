/**
 * The session-entry model and compaction engine PI-Desktop pins.
 *
 * pi 1.0 folded the agent harness into `@earendil-works/pi-coding-agent` and
 * closed its public export: the entry model, `prepareCompaction`, the
 * message-based `estimateContextTokens`, and the summary factories that
 * served them no longer exist under `@earendil-works/pi-agent-core`, and its
 * root now exposes a projection-era engine built around native v3 JSONL
 * sessions instead (no `retainedTail`, plain returns in place of `Result`).
 *
 * Desktop's D203 compaction drives an entry list it owns end to end, so this
 * module carries the 0.87.1 pure functions verbatim — the entry types, the
 * cut-point walk, file operations, token estimates (which do not count the
 * system prompt), and the `Result` semantics the runtime and its tests
 * encode. Retire this port when Desktop adopts the projection-era engine
 * wholesale.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";

export type { AgentMessage };

/** Dual-shaped outcome of bounded helpers; `err` carries a typed code. */
export type Result<TOk, TError> =
  | { ok: true; value: TOk }
  | { ok: false; error: TError };

export function ok<TOk>(value: TOk): Result<TOk, never> {
  return { ok: true, value };
}

/** Stable compaction error codes, as pi 0.87's harness returned them. */
export type CompactionErrorCode = "aborted" | "summarization_failed";

export class CompactionError extends Error {
  /** Backend-independent error code. */
  readonly code: CompactionErrorCode;

  constructor(code: CompactionErrorCode, message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "CompactionError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Entry model
// ---------------------------------------------------------------------------

export type EntryType = "message" | "compaction" | "branch_summary" | "custom";

export interface EntryBase {
  id: string;
  parentId: string | null;
  seq: number;
  timestamp: number;
  type: EntryType;
  customType?: string;
}

export interface MessageEntry extends EntryBase {
  type: "message";
  message: AgentMessage;
  terminate?: true;
}

export interface CompactionEntry extends EntryBase {
  type: "compaction";
  summary: string;
  retainedTail: AgentMessage[];
  tokensBefore: number;
  details?: unknown;
  usage?: Usage;
  fromHook: boolean;
}

export interface BranchSummaryEntry extends EntryBase {
  type: "branch_summary";
  fromId: string | null;
  summary: string;
  details?: unknown;
  usage?: Usage;
  fromHook: boolean;
}

export interface CustomEntry extends EntryBase {
  type: "custom";
  customType: string;
  data?: unknown;
}

export type Entry =
  | MessageEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry;

// ---------------------------------------------------------------------------
// Compaction contract
// ---------------------------------------------------------------------------

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface FileOperations {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

/** Prepared inputs for a compaction run (0.87 shape, `retainedTail` included). */
export interface CompactionPreparation {
  /** Messages summarized into the history summary. */
  messagesToSummarize: AgentMessage[];
  /** Prefix messages summarized separately when compaction splits a turn. */
  turnPrefixMessages: AgentMessage[];
  /** Recent messages retained after compaction and stored with the checkpoint. */
  retainedTail: AgentMessage[];
  /** Whether compaction splits a turn. */
  isSplitTurn: boolean;
  /** Estimated context tokens before compaction. */
  tokensBefore: number;
  /** Previous compaction summary used for iterative updates. */
  previousSummary?: string;
  /** File operations extracted from the summarized history. */
  fileOps: FileOperations;
  /** Settings used to prepare compaction. */
  settings: CompactionSettings;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

export interface ContextUsageEstimate {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number | null;
}

/** Total context tokens from usage: native total when present, else the parts. */
export function calculateContextTokens(usage: Usage): number {
  return (
    usage.totalTokens ||
    usage.input + usage.output + usage.cacheRead + usage.cacheWrite
  );
}

function getAssistantUsage(msg: AgentMessage): Usage | undefined {
  if (msg.role === "assistant" && "usage" in msg) {
    const assistantMsg = msg;
    if (
      assistantMsg.stopReason !== "aborted" &&
      assistantMsg.stopReason !== "error" &&
      assistantMsg.usage &&
      calculateContextTokens(assistantMsg.usage) > 0
    ) {
      return assistantMsg.usage;
    }
  }
  return undefined;
}

function getLastAssistantUsageInfo(
  messages: AgentMessage[],
): { usage: Usage; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = getAssistantUsage(messages[i]);
    if (usage) return { usage, index: i };
  }
  return undefined;
}

/** Conservative char budget of text/image blocks. */
const ESTIMATED_IMAGE_CHARS = 4800;

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

function estimateTextAndImageContentChars(
  content: string | readonly unknown[],
): number {
  if (typeof content === "string") {
    return content.length;
  }
  let chars = 0;
  for (const block of content) {
    if (block && typeof block === "object") {
      const record = block as { type?: unknown; text?: unknown; thinking?: unknown };
      if (record.type === "text" && record.text) {
        chars += String(record.text).length;
      } else if (record.type === "image") {
        chars += ESTIMATED_IMAGE_CHARS;
      }
    }
  }
  return chars;
}

/** Estimate token count for one message using a conservative chars/4 heuristic. */
export function estimateTokens(message: AgentMessage): number {
  let chars = 0;
  switch (message.role) {
    case "user": {
      chars = estimateTextAndImageContentChars(message.content);
      return Math.ceil(chars / 4);
    }
    case "assistant": {
      const assistant = message;
      for (const block of assistant.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "thinking") {
          chars += block.thinking.length;
        } else if (block.type === "toolCall") {
          chars += block.name.length + safeJsonStringify(block.arguments).length;
        }
      }
      return Math.ceil(chars / 4);
    }
    case "custom":
    case "toolResult": {
      chars = estimateTextAndImageContentChars(message.content);
      return Math.ceil(chars / 4);
    }
    case "bashExecution": {
      chars = message.command.length + message.output.length;
      return Math.ceil(chars / 4);
    }
    case "branchSummary":
    case "compactionSummary": {
      chars = message.summary.length;
      return Math.ceil(chars / 4);
    }
  }
  return 0;
}

/** Estimate context tokens for messages using provider usage when available. */
export function estimateContextTokens(
  messages: AgentMessage[],
): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);
  if (!usageInfo) {
    let estimated = 0;
    for (const message of messages) {
      estimated += estimateTokens(message);
    }
    return {
      tokens: estimated,
      usageTokens: 0,
      trailingTokens: estimated,
      lastUsageIndex: null,
    };
  }
  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]);
  }
  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  };
}

// ---------------------------------------------------------------------------
// Entry → context projection shared with the D203 engine
// ---------------------------------------------------------------------------

function isContextMessage(message: AgentMessage): boolean {
  return (
    message.role !== "assistant" ||
    (message.stopReason !== "error" &&
      message.stopReason !== "aborted" &&
      message.stopReason !== "deferred")
  );
}

/**
 * Entry → model messages with the 0.87 context filter: failed, aborted and
 * deferred assistant turns stay transcript-only. The projection in
 * `session-context.ts` re-uses this so one filter governs both.
 */
export function sessionEntryToContextMessages(entry: Entry): AgentMessage[] {
  switch (entry.type) {
    case "message":
      return isContextMessage(entry.message) ? [entry.message] : [];
    case "compaction":
      return [
        createCompactionSummaryMessage(
          entry.summary,
          entry.tokensBefore,
          entry.timestamp,
        ),
        ...entry.retainedTail.filter(isContextMessage),
      ];
    case "branch_summary":
      return entry.summary
        ? [
            createBranchSummaryMessage(
              entry.summary,
              entry.fromId,
              entry.timestamp,
            ),
          ]
        : [];
    case "custom":
      return [];
  }
}

/**
 * Path context read from the top: up to and including the latest compaction
 * entry plus everything after it. D203 depends on this order.
 */
export function buildContextEntries(pathEntries: readonly Entry[]): Entry[] {
  for (let index = pathEntries.length - 1; index >= 0; index--) {
    const entry = pathEntries[index];
    if (entry?.type === "compaction") {
      return [entry, ...pathEntries.slice(index + 1)];
    }
  }
  return [...pathEntries];
}

// ---------------------------------------------------------------------------
// Cut point
// ---------------------------------------------------------------------------

function findValidCutPoints(
  entries: Entry[],
  startIndex: number,
  endIndex: number,
): number[] {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i];
    switch (entry.type) {
      case "message": {
        const role = entry.message.role;
        switch (role) {
          case "bashExecution":
          case "custom":
          case "branchSummary":
          case "compactionSummary":
          case "user":
          case "assistant":
            cutPoints.push(i);
            break;
          case "toolResult":
            break;
        }
        break;
      }
      case "compaction":
      case "branch_summary":
      case "custom":
        break;
    }
    if (entry.type === "branch_summary") cutPoints.push(i);
  }
  return cutPoints;
}

export function findTurnStartIndex(
  entries: Entry[],
  entryIndex: number,
  startIndex: number,
): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry.type === "branch_summary") {
      return i;
    }
    if (entry.type === "message") {
      const role = entry.message.role;
      if (role === "user" || role === "bashExecution") {
        return i;
      }
    }
  }
  return -1;
}

export function findCutPoint(
  entries: Entry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): {
  firstKeptEntryIndex: number;
  turnStartIndex: number;
  isSplitTurn: boolean;
} {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);
  if (cutPoints.length === 0) {
    return {
      firstKeptEntryIndex: startIndex,
      turnStartIndex: -1,
      isSplitTurn: false,
    };
  }
  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0];
  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry.type !== "message") continue;
    const messageTokens = estimateTokens(entry.message);
    accumulatedTokens += messageTokens;
    if (accumulatedTokens >= keepRecentTokens) {
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c] >= i) {
          cutIndex = cutPoints[c];
          break;
        }
      }
      break;
    }
  }
  while (cutIndex > startIndex) {
    const prevEntry = entries[cutIndex - 1];
    if (prevEntry.type === "compaction") {
      break;
    }
    if (prevEntry.type === "message") {
      break;
    }
    cutIndex--;
  }
  const cutEntry = entries[cutIndex];
  const isUserMessage =
    cutEntry.type === "message" && cutEntry.message.role === "user";
  const turnStartIndex = isUserMessage
    ? -1
    : findTurnStartIndex(entries, cutIndex, startIndex);
  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserMessage && turnStartIndex !== -1,
  };
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

function createFileOps(): FileOperations {
  return {
    read: new Set(),
    written: new Set(),
    edited: new Set(),
  };
}

/** Add file operations from assistant tool calls to an accumulator. */
function extractFileOpsFromMessage(
  message: AgentMessage,
  fileOps: FileOperations,
): void {
  if (message.role !== "assistant") return;
  if (!("content" in message) || !Array.isArray(message.content)) return;
  for (const block of message.content) {
    if (typeof block !== "object" || block === null) continue;
    if (!("type" in block) || block.type !== "toolCall") continue;
    if (!("arguments" in block) || !("name" in block)) continue;
    const args = block.arguments as Record<string, unknown> | undefined;
    if (!args) continue;
    const path = typeof args.path === "string" ? args.path : undefined;
    if (!path) continue;
    switch (block.name) {
      case "read":
        fileOps.read.add(path);
        break;
      case "write":
        fileOps.written.add(path);
        break;
      case "edit":
        fileOps.edited.add(path);
        break;
    }
  }
}

function extractFileOperations(
  messages: AgentMessage[],
  entries: Entry[],
  prevCompactionIndex: number,
): FileOperations {
  const fileOps = createFileOps();
  const prevCompaction =
    prevCompactionIndex >= 0 ? entries[prevCompactionIndex] : undefined;
  const details =
    prevCompaction?.type === "compaction" &&
    prevCompaction.details &&
    typeof prevCompaction.details === "object" &&
    !Array.isArray(prevCompaction.details)
      ? (prevCompaction.details as Record<string, unknown>)
      : undefined;
  if (Array.isArray(details?.readFiles)) {
    for (const path of details.readFiles) {
      if (typeof path === "string") fileOps.read.add(path);
    }
  }
  if (Array.isArray(details?.modifiedFiles)) {
    for (const path of details.modifiedFiles) {
      if (typeof path === "string") fileOps.edited.add(path);
    }
  }
  for (const msg of messages) {
    extractFileOpsFromMessage(msg, fileOps);
  }
  return fileOps;
}

// ---------------------------------------------------------------------------
// Summary factory messages
// ---------------------------------------------------------------------------

function createBranchSummaryMessage(
  summary: string,
  fromId: string | null,
  timestamp: string | number,
): AgentMessage {
  return {
    role: "branchSummary",
    summary,
    fromId,
    timestamp:
      typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime(),
  };
}

function createCompactionSummaryMessage(
  summary: string,
  tokensBefore: number,
  timestamp: string | number,
): AgentMessage {
  return {
    role: "compactionSummary",
    summary,
    tokensBefore,
    timestamp:
      typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime(),
  };
}

// ---------------------------------------------------------------------------
// Entry → message projection helpers used by the engine below
// ---------------------------------------------------------------------------

/**
 * Message each entry contributes to the compactable range — the compaction
 * engine's variant, which unlike the branch summarizer keeps tool results so
 * a call and its result are always summarized together.
 */
function getMessageFromEntry(entry: Entry): AgentMessage | undefined {
  if (entry.type === "message") {
    return entry.message;
  }
  if (entry.type === "branch_summary") {
    return createBranchSummaryMessage(
      entry.summary,
      entry.fromId,
      entry.timestamp,
    );
  }
  if (entry.type === "compaction") {
    return createCompactionSummaryMessage(
      entry.summary,
      entry.tokensBefore,
      entry.timestamp,
    );
  }
  return undefined;
}

function getMessageFromEntryForCompaction(
  entry: Entry,
): AgentMessage | undefined {
  if (entry.type === "compaction") {
    return undefined;
  }
  return getMessageFromEntry(entry);
}

// ---------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------

/**
 * Prepare session entries for compaction, or `undefined` when nothing is
 * compactable. Same cut-point walk as the pinned 0.87 kernel: walk back from
 * the newest message until `keepRecentTokens` accumulates, then align the cut
 * with the nearest valid boundary without splitting a tool result away.
 */
export function prepareCompaction(
  pathEntries: Entry[],
  settings: CompactionSettings,
): Result<CompactionPreparation | undefined, CompactionError> {
  if (
    pathEntries.length === 0 ||
    pathEntries[pathEntries.length - 1].type === "compaction"
  ) {
    return ok(undefined);
  }
  let prevCompactionIndex = -1;
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    if (pathEntries[i].type === "compaction") {
      prevCompactionIndex = i;
      break;
    }
  }
  let previousSummary: string | undefined;
  let compactableEntries = pathEntries;
  if (prevCompactionIndex >= 0) {
    const prevCompaction = pathEntries[prevCompactionIndex];
    if (prevCompaction.type === "compaction") {
      previousSummary = prevCompaction.summary;
      // pi 0.84+ replays a previous checkpoint's `retainedTail` as virtual
      // entries at the head of the compactable range, so the retained tail
      // participates in the cut like any other message.
      const virtualRetainedEntries: Entry[] = prevCompaction.retainedTail.map(
        (message: AgentMessage, index: number): Entry => ({
          type: "message",
          id: `${prevCompaction.id}:retained:${index}`,
          parentId:
            index === 0
              ? prevCompaction.id
              : `${prevCompaction.id}:retained:${index - 1}`,
          seq: prevCompaction.seq,
          timestamp: message.timestamp,
          message,
        }),
      );
      compactableEntries = [
        ...virtualRetainedEntries,
        ...pathEntries.slice(prevCompactionIndex + 1),
      ];
    }
  }
  const boundaryEnd = compactableEntries.length;
  const tokensBefore = estimateContextTokens(
    buildContextEntries(pathEntries).flatMap(sessionEntryToContextMessages),
  ).tokens;
  const cutPoint = findCutPoint(
    compactableEntries,
    0,
    boundaryEnd,
    settings.keepRecentTokens,
  );
  const historyEnd = cutPoint.isSplitTurn
    ? cutPoint.turnStartIndex
    : cutPoint.firstKeptEntryIndex;
  const messagesToSummarize: AgentMessage[] = [];
  for (let i = 0; i < historyEnd; i++) {
    const msg = getMessageFromEntryForCompaction(compactableEntries[i]);
    if (msg) messagesToSummarize.push(msg);
  }
  const turnPrefixMessages: AgentMessage[] = [];
  if (cutPoint.isSplitTurn) {
    for (
      let i = cutPoint.turnStartIndex;
      i < cutPoint.firstKeptEntryIndex;
      i++
    ) {
      const msg = getMessageFromEntryForCompaction(compactableEntries[i]);
      if (msg) turnPrefixMessages.push(msg);
    }
  }
  const retainedTail: AgentMessage[] = [];
  for (let i = cutPoint.firstKeptEntryIndex; i < boundaryEnd; i++) {
    const msg = getMessageFromEntryForCompaction(compactableEntries[i]);
    if (msg) retainedTail.push(msg);
  }
  const fileOps = extractFileOperations(
    messagesToSummarize,
    pathEntries,
    prevCompactionIndex,
  );
  if (cutPoint.isSplitTurn) {
    for (const msg of turnPrefixMessages) {
      extractFileOpsFromMessage(msg, fileOps);
    }
  }
  return ok({
    messagesToSummarize,
    turnPrefixMessages,
    retainedTail,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    settings,
  });
}
