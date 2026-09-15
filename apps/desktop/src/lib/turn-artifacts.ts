import type { AssistantTurnEntry } from "./assistant-turns";
import { assistantTurnMessages } from "./assistant-turns";
// Import the scanner directly: the `chat-links` barrel is the renderer-facing
// surface, and a directory import does not resolve under the Node ESM loader
// the unit tests use.
import { splitChatText } from "./chat-links/scan";

/**
 * One file the turn reported as an output: a build artifact, an installed
 * package, an exported document.
 *
 * Artifacts are read from the turn's final answer, which is where the agent
 * states what it produced. That keeps the section honest — it reports what the
 * turn claimed, not what a directory happens to contain — and it covers
 * outputs no Write/Edit record can see, such as a file an installer or a build
 * command created.
 */
export type TurnArtifact = {
  /** Path to open: workspace-relative, or absolute for an outside target. */
  path: string;
  /** The reported line that names it, so the row shows what it is. */
  note: string;
  /** True when the path lives outside the workspace (opens through the OS). */
  external: boolean;
};

const NOTE_MAX = 110;
export const MAX_TURN_ARTIFACTS = 12;

/** Last assistant message that carries text: the turn's report. */
function finalTurnText(entry: AssistantTurnEntry): string {
  const messages = assistantTurnMessages(entry);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = (messages[index].content ?? "").trim();
    if (content) return content;
  }
  return "";
}

function clampNote(line: string): string {
  const text = line.trim().replace(/^[-*+]\s+/, "");
  return text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX)}…` : text;
}

/**
 * Collect the output paths the turn reported, in report order.
 *
 * `exclude` carries the paths already listed as changes: a file the turn wrote
 * belongs in the changes table, not twice in the summary. URLs are skipped —
 * only local files can be opened or located on disk.
 */
export function turnArtifacts(
  entry: AssistantTurnEntry,
  root: string | null | undefined,
  exclude: readonly string[] = [],
): TurnArtifact[] {
  const text = finalTurnText(entry);
  if (!text) return [];
  const taken = new Set(exclude);
  const found: TurnArtifact[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    for (const segment of splitChatText(line, root)) {
      if (segment.kind !== "target") continue;
      if (segment.target.kind !== "file") continue;
      const path = segment.target.path;
      if (taken.has(path)) continue;
      // A bare filename the report mentions ("package.json") resolves to the
      // same path twice under different spellings; dedupe on the resolved one.
      taken.add(path);
      found.push({
        path,
        note: clampNote(line),
        external: Boolean(segment.target.external),
      });
      if (found.length >= MAX_TURN_ARTIFACTS) return found;
    }
  }
  return found;
}
