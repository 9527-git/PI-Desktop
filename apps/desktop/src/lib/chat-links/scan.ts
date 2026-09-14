/**
 * Scan plain chat text for file/URL references and split it into literal runs
 * and previewable targets. Used by user messages (chips) and, through
 * `mdast.ts`, by markdown phrasing.
 */

import {
  SEG,
  leafName,
  toPosix,
  trimPathToken,
} from "./path-shape";
import {
  resolvePreviewTarget,
  type ChatPreviewTarget,
} from "./resolve";

export type ChatTextSegment =
  | { kind: "text"; text: string }
  | {
      kind: "target";
      text: string;
      /** Compact leaf label for file chips; the raw token for URLs. */
      label: string;
      target: ChatPreviewTarget;
    };

/**
 * The scan alternation, most specific first: `@refs`, URLs, drive paths,
 * `./`-relative, slash paths, then bare dotted names. Segment characters come
 * from `path-shape.SEG`, which excludes separators, so the repetitions stay
 * linear on hostile input.
 */
const SEPARATOR = "[\\u005c/]";
const SCAN_RE = new RegExp(
  '@"[^"\\n]+"|@\\S+' +
    `|https?:\\/\\/[^\\s<>"'\u0060()[\\]{}]+` +
    "|[A-Za-z]:" + SEPARATOR + "(?:" + SEG + SEPARATOR + ")*" + SEG + "(?::\\d+(?::\\d+)?)?" +
    "|\\.{1,2}" + SEPARATOR + "(?:" + SEG + SEPARATOR + ")*" + SEG + "(?::\\d+(?::\\d+)?)?" +
    "|(?:" + SEG + SEPARATOR + ")+" + SEG + "(?::\\d+(?::\\d+)?)?" +
    "|[\\w@+-][\\w@+.-]*\\.[A-Za-z0-9]{1,8}\\b",
  "gu",
);

/**
 * Split plain chat text (user messages) into literal runs and previewable
 * references. Unresolvable candidates stay literal text. File targets carry a
 * leaf-name `label` so the transcript can render composer-like chips (D320).
 */
export function splitChatText(
  text: string,
  root?: string | null,
  baseDir?: string | null,
): ChatTextSegment[] {
  const segments: ChatTextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(SCAN_RE)) {
    const raw = trimPathToken(match[0]);
    const start = match.index ?? 0;
    const length = raw.length;
    if (!raw) continue;
    const target = resolvePreviewTarget(raw, root, baseDir);
    if (!target) continue;
    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    const label = target.kind === "file" ? leafName(target.path) : raw;
    segments.push({ kind: "target", text: raw, label, target });
    last = start + length;
  }
  if (segments.length === 0) return [{ kind: "text", text }];
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** Leaf label for a resolved file target; used by chip renderers. */
export function chipLabelFor(path: string): string {
  return leafName(toPosix(path)) || path;
}
