import type { TranscriptEntry } from "../../../lib/assistant-turns";

export type TurnProgressGate = {
  /** The running turn owns the card; no decision card is standing in for it. */
  open: boolean;
  /** The running turn's own entry, or null while the tail is not that turn's. */
  entry: Extract<TranscriptEntry, { kind: "assistant-turn" }> | null;
  /** The card is drawn only on screen: a hidden pane has no viewport. */
  onScreen: boolean;
};

/**
 * Which turn the progress card speaks for (ADR 0264).
 *
 * The running turn opens the card on its own: a turn with no rows yet still
 * has its phase and the clock to say (ADR 0263), so the gate is the turn
 * itself and not the shape of the transcript's tail. Its steps come only from
 * a tail entry that belongs to that turn — a user row, a compaction divider,
 * or an activity-only tail leaves the entry null rather than lending the card
 * the previous turn's steps.
 *
 * An actionable interruption stands the card down: a permission, question, or
 * approval card is a decision, and §2.4 of the interaction patterns keeps it
 * out of the progress surfaces. A hidden retained pane never puts it on
 * screen, because it has no viewport to read from (ADR 0260).
 */
export function turnProgressGate({
  running,
  interrupted,
  tailEntry,
  paneVisible,
  veilCovering,
}: {
  running: boolean;
  interrupted: boolean;
  tailEntry: TranscriptEntry | undefined;
  paneVisible: boolean;
  veilCovering: boolean;
}): TurnProgressGate {
  const open = running && !interrupted;
  return {
    open,
    entry: open && tailEntry?.kind === "assistant-turn" ? tailEntry : null,
    onScreen: open && paneVisible && !veilCovering,
  };
}
