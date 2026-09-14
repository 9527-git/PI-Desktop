/**
 * Path *shape* helpers for chat-referenced paths: separator normalization,
 * Windows drive letters, MSYS-style mounts, and the heuristics that decide
 * whether a bare token is a path at all.
 *
 * Pure string work — nothing here touches the filesystem or knows about the
 * workspace root (that lives in `resolve.ts`).
 */

/** Extensions that make an unqualified token count as a file. */
const KNOWN_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "css", "scss", "less",
  "html", "htm", "md", "mdx", "txt", "rs", "py", "go", "rb", "sh", "zsh",
  "bash", "yml", "yaml", "toml", "sql", "swift", "kt", "java", "c", "h",
  "cpp", "hpp", "cs", "php", "vue", "svelte", "xml", "ini", "cfg", "conf",
  "env", "lock", "svg", "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf",
  "csv", "tsv", "log",
]);

const KNOWN_BARE_NAMES = new Set([
  "Makefile",
  "Dockerfile",
  "LICENSE",
  "README",
  "CHANGELOG",
]);

/**
 * One path segment: no whitespace, no shell/markdown punctuation, no
 * backslash or backtick (regex-escaped as \u005c / \u0060 so the class also
 * excludes separators — this keeps `SEG + separator` quantifiers linear), no
 * Windows-invalid character, and no CJK sentence punctuation (a path written
 * inside Chinese prose must stop at the trailing `。` or `、`).
 */
const SEG_CHAR =
  "[^\\s<>\"'\\u005c\\u0060|*?(){}\\[\\],;!。、，；：「」『』（）【】]";

/** Separators a path token may use between segments. */
const SEP = "[\\\\/]";

export const SEG = `${SEG_CHAR}+`;

/** Drive-prefixed path: `C:\dir\file.ts`, `E:/pi-pro/x`, `d:\root`. */
export const DRIVE_PATH_RE = new RegExp(
  `^[A-Za-z]:${SEP}(?:${SEG}${SEP})*${SEG}$`,
);

/** POSIX absolute path: `/a/b`. */
export const POSIX_ABS_RE = new RegExp(
  `^${SEP}(?:${SEG}${SEP})*${SEG}$`,
);

/** MSYS/Git-Bash mount form: `/e/pi-pro/...` — a drive path on Windows only. */
export const MSYS_MOUNT_RE = new RegExp(
  `^${SEP}([A-Za-z])${SEP}(?:${SEG}${SEP})*${SEG}$`,
);

/** Convert any separator style to `/`. */
export function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/** True on Windows, where an MSYS mount is a drive path. Read lazily so the
 * module also loads in Node tests. */
export function isWindowsHost(): boolean {
  const desktop = (globalThis as { window?: { piDesktop?: { platform?: string } } })
    .window?.piDesktop;
  return desktop?.platform === "win32";
}

export function isDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

/** Absolute in the local sense: POSIX root or Windows drive. `~` is never
 * absolute because nothing here can resolve it. */
export function isAbsoluteLocalPath(path: string): boolean {
  if (!path || path.startsWith("~")) return false;
  return isDrivePath(path) || POSIX_ABS_RE.test(path);
}

/** Collapse `.` / `..` and unify separators. Returns null when `..` walks past
 * the anchor, which is how a relative reference stays inside its base. */
export function normalizePathSegments(path: string): string | null {
  const normalized = toPosix(path);
  const anchored = normalized.startsWith("/");
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        if (anchored) return null;
        segments.push("..");
        continue;
      }
      if (segments.at(-1) === "..") segments.push("..");
      else segments.pop();
      continue;
    }
    if (segments.at(-1) === "..") segments.pop();
    else segments.push(segment);
  }
  if (segments.length === 0) return anchored ? "/" : null;
  return anchored ? `/${segments.join("/")}` : segments.join("/");
}

/** `E:\x\a.ts:42:7` → `E:/x/a.ts`. The line ref is display chrome, not path. */
export function stripLineRef(path: string): string {
  return path.replace(/:\d+(?::\d+)?$/, "");
}

/** Remove scan-swept trailing dots/separators. Other punctuation never enters
 * a token because the segment class already excludes it. */
export function trimPathToken(token: string): string {
  // A bare drive root (`C:\`) stays intact; every other path drops the tail.
  if (/^[A-Za-z]:[\\/]$/.test(token)) return token;
  return token.replace(/[.]+$/, "").replace(/[\\/]+$/, "");
}

/** Parent directory of any path shape; "" when there is none. */
export function fileDirOf(path: string): string {
  const normalized = toPosix(path).replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "" : normalized.slice(0, index);
}

export function leafName(path: string): string {
  const normalized = toPosix(path).replace(/\/+$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || path;
}

function extensionOf(path: string): string {
  const base = toPosix(path).split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * Does this token name something openable? An *absolute* path counts even
 * without an extension — the writer chose it deliberately and it may be a
 * folder. A relative token needs a known extension or bare-name, so ordinary
 * dotted identifiers (`store.messages`) stay plain text.
 */
export function isLikelyFilePath(path: string): boolean {
  const normalized = toPosix(path);
  if (isAbsoluteLocalPath(path)) return true;
  const base = normalized.split("/").pop() ?? "";
  const ext = extensionOf(path);
  if (normalized.includes("/")) {
    if (ext && ext.length <= 8) return true;
    return KNOWN_BARE_NAMES.has(base);
  }
  if (KNOWN_BARE_NAMES.has(base)) return true;
  return KNOWN_EXTS.has(ext);
}
