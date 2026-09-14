/**
 * Token-level parsing of chat file references: the `@path` composer sigil and
 * the trailing `:line[:col]` chrome. Resolution against the workspace lives in
 * `resolve.ts`; scanning prose lives in `scan.ts`.
 */

import { isLikelyFilePath, stripLineRef } from "./path-shape";

const AT_QUOTED_RE = /^@"([^"\n]+)"$/;
const AT_UNQUOTED_RE = /^@(\S+)$/;

export function isHttpUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

export function isHtmlFilePath(path: string): boolean {
  return /\.html?$/i.test(path);
}

export function safeDecodeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/**
 * Returns the cleaned path when `text` plausibly names a file (trailing
 * `:line[:col]` refs are stripped), otherwise null. A leading `@` — the
 * composer's file-reference sigil (D124) — is accepted and stripped so
 * `@src/a.ts` previews like `src/a.ts`.
 */
export function parseFileRef(text: string): string | null {
  let raw = text.trim();
  if (!raw || raw.length > 512) return null;
  if (raw.startsWith("@")) raw = raw.slice(1);
  if (!raw || !fileTokenShape(raw)) return null;
  const path = stripLineRef(raw);
  return isLikelyFilePath(path) ? path : null;
}

/**
 * Unwrap a composer-serialized `@path` / `@"path with spaces"` token into the
 * canonical path. Quoted paths keep interior whitespace; unquoted tokens stop
 * at whitespace. Returns null when the token is not an `@` file reference.
 */
export function unwrapAtFileRef(text: string): string | null {
  const raw = text.trim();
  if (!raw || raw.length > 512) return null;
  const quoted = raw.match(AT_QUOTED_RE);
  if (quoted) {
    const path = stripLineRef(quoted[1]);
    return path && isLikelyFilePath(path) ? path : null;
  }
  const unquoted = raw.match(AT_UNQUOTED_RE);
  if (unquoted) {
    const path = stripLineRef(unquoted[1]);
    return path && isLikelyFilePath(path) ? path : null;
  }
  return null;
}

/**
 * Whole-token shape check for `parseFileRef`: an optional drive prefix, an
 * optional leading separator or `./` / `../`, segments joined by `/` or `\`,
 * and optional `:line[:col]` chrome. Built by hand instead of from `SEG` so
 * the accepted shape stays readable.
 */
const SEGMENT = String.raw`[^\s<>"'` +
  "`" +
  String.raw`|*?(){}\[\],;!。、，；：「」『』（）【】]+`;
const SEPARATOR = String.raw`[\\/]`;

function fileTokenShape(token: string): boolean {
  const drive = String.raw`(?:[A-Za-z]:)?`;
  const lead = String.raw`(?:${SEPARATOR}|\.{1,2}${SEPARATOR})?`;
  const tail = String.raw`(?::\d+(?::\d+)?)?`;
  const shape = new RegExp(
    String.raw`^${drive}${lead}${SEGMENT}(?:${SEPARATOR}${SEGMENT})*${tail}$`,
  );
  return shape.test(token);
}
