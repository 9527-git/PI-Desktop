/**
 * Scan plain chat text for file/URL references and split it into literal runs
 * and previewable targets. Used by user messages (chips) and, through
 * `mdast.ts`, by markdown phrasing.
 *
 * The alternation is ordered most-specific-first, and every repetition is
 * anchored on a segment class that excludes the backslash separator, so a
 * hostile run of tokens scans linearly instead of exploding on nested
 * quantifiers. Segment characters are shared with `path-shape`, so a token
 * accepted here is the same shape the parser validates.
 */

import { SEG, leafName, toPosix } from "./path-shape";
import { resolvePreviewTarget, type ChatPreviewTarget } from "./resolve";

export type ChatTextSegment =
  | { kind: "text"; text: string }
  | {
      kind: "target";
      text: string;
      /** Compact leaf label for file chips; the raw token for URLs. */
      label: string;
      target: ChatPreviewTarget;
    };

const SEPARATOR = "[\\u005c/]";

/**
 * A segment that may contain spaces — Windows install paths are full of them
 * ("C:\\Program Files\\App\\app.exe"). The scan only offers this shape to
 * tokens that start like an explicit path (drive, root, or `./`) and end in an
 * extension, so `see README.md and notes.txt` still yields two references
 * instead of one runaway match. Colons stay excluded so a spaced segment
 * cannot swallow the next token's drive prefix.
 */
const SPACED =
  "[^<>\"'\\u0060|*?(){}\\[\\],;!。、，；：「」『』（）【】：\\u005c/]+";
const SPACED_PATH =
  "(?:[A-Za-z]:|\\.{1,2})?" + SEPARATOR + "(?:" + SPACED + SEPARATOR + ")*?" +
  SPACED + "\\.[A-Za-z0-9]{1,8}";

/** `:12` / `:12:7` line chrome; `stripLineRef` drops it before resolution. */
const LINE_REF = "(?::\\d+(?::\\d+)?)?";

/**
 * Optional `~/` or `/` anchor on a multi-segment token, captured whole so the
 * resolver sees the real anchor: an outside absolute or a home path then fails
 * resolution and stays plain text instead of chipping a suffix that could
 * never open (#235).
 */
const ANCHOR = "(?:~" + SEPARATOR + ")?" + SEPARATOR + "?";

/**
 * Unicode-aware bare name (#235). `\p{L}` / `\p{N}` keep CJK filenames
 * linking, and the extension tail uses `(?![A-Za-z0-9_])` rather than `\b`,
 * because a word boundary would stop `App.tsx文件` from linking.
 */
const BARE_NAME =
  "[\\p{L}\\p{N}_@+-][\\p{L}\\p{N}_@+.-]*\\.[A-Za-z0-9]{1,8}(?![A-Za-z0-9_])";

const SCAN_RE = new RegExp(
  '@"[^"\\n]+"|@\\S+' +
    `|https?:\\/\\/[^\\s<>"'\\u0060()[\\]{}]+` +
    "|" + SPACED_PATH +
    "|[A-Za-z]:" + SEPARATOR + "(?:" + SEG + SEPARATOR + ")*" + SEG + LINE_REF +
    "|\\.{1,2}" + SEPARATOR + "(?:" + SEG + SEPARATOR + ")*" + SEG + LINE_REF +
    "|" + ANCHOR + "(?:" + SEG + SEPARATOR + ")+" + SEG + LINE_REF +
    "|" + BARE_NAME,
  "gu",
);

/** Remove scan-swept trailing dots/separators. Other punctuation never enters
 * a token because the segment class already excludes it. */
function trimPathToken(token: string): string {
  // A bare drive root (`C:\`) stays intact; every other path drops the tail.
  if (/^[A-Za-z]:[\\/]$/.test(token)) return token;
  return token.replace(/[.]+$/, "").replace(/[\\/]+$/, "");
}

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
