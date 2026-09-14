import type { AssistantTurnEntry } from "./assistant-turns";
import { assistantTurnTools } from "./assistant-turns";
import { reviewChangeFromMessage, type ReviewChangeEntry } from "./workspace-review";

/** The three statuses a workspace Write/Edit record can carry. */
export type TurnFileStatus = "added" | "modified" | "deleted";

/** One workspace file a turn touched, with its per-call evidence records. */
export type TurnFileChange = {
  path: string;
  /** Net status within the turn: added / modified / deleted. */
  status: TurnFileStatus;
  additions: number;
  deletions: number;
  /** Successful per-call records, in call order. */
  records: ReviewChangeEntry[];
};

export type TurnFilesTotal = { additions: number; deletions: number };

/**
 * Aggregate one turn's durable workspace file changes by path.
 *
 * Evidence is message-local (the review record embedded in each successful
 * Write/Edit tool result), so no current Git state is consulted and the card
 * reports exactly what the review tab records. Rolled-back records are
 * excluded: they left no durable change. Per path, a later delete wins, an
 * added status sticks, and modifications never overwrite an earlier
 * added/deleted classification.
 */
export function turnFileChanges(entry: AssistantTurnEntry): TurnFileChange[] {
  const byPath = new Map<string, TurnFileChange>();
  for (const message of assistantTurnTools(entry)) {
    const change = reviewChangeFromMessage(message);
    if (!change || change.state !== "active") continue;
    const existing = byPath.get(change.path);
    if (!existing) {
      byPath.set(change.path, {
        path: change.path,
        // workspace-review validates the record to these three statuses.
        status: change.status as TurnFileStatus,
        additions: change.additions,
        deletions: change.deletions,
        records: [{ message, change }],
      });
      continue;
    }
    existing.records.push({ message, change });
    existing.additions += change.additions;
    existing.deletions += change.deletions;
    if (change.status !== "modified") {
      existing.status = change.status as TurnFileStatus;
    }
  }
  return [...byPath.values()];
}

/** Turn-level +additions/−deletions totals for the summary header. */
export function turnFilesTotal(
  files: readonly TurnFileChange[],
): TurnFilesTotal {
  return files.reduce<TurnFilesTotal>(
    (total, file) => ({
      additions: total.additions + file.additions,
      deletions: total.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}
