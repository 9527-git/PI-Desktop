/**
 * Resolve a chat-mentioned path onto something openable: a workspace-relative
 * path for the work panel, or — for Windows drive paths (and MSYS mounts on a
 * Windows host) — an absolute local path outside the workspace that the host
 * opens through its own containment gate.
 *
 * POSIX-style absolute paths keep the historical semantics: they only resolve
 * when they live under the workspace root, and stay null otherwise, because a
 * `/usr/...` token in prose is far more likely to be an example than a file.
 */

import {
  isDrivePath,
  MSYS_MOUNT_RE,
  isWindowsHost,
  normalizePathSegments,
  toPosix,
} from "./path-shape";
import { isHttpUrl, parseFileRef, unwrapAtFileRef } from "./parse";

export type ChatPreviewTarget =
  | { kind: "file"; path: string; external?: true }
  | { kind: "url"; url: string };

/** Normalize a drive path: unify separators, uppercase the drive letter. */
function normalizeDrivePath(path: string): string {
  const posix = toPosix(path);
  return posix[0].toUpperCase() + posix.slice(1);
}

/** `/e/x` → `E:/x`. Only meaningful on a Windows host; elsewhere `/e/x` is a
 * real POSIX path and must never be rewritten. */
function msysToDrive(path: string): string | null {
  const mount = toPosix(path).match(MSYS_MOUNT_RE);
  if (!mount || !isWindowsHost()) return null;
  // `/e/` is exactly three characters before the mounted path.
  return normalizeDrivePath(`${mount[1].toUpperCase()}:${path.slice(3)}`);
}

/** Canonical absolute form of a drive/MSYS path token, or null. */
export function absoluteLocalPath(path: string): string | null {
  const clean = normalizePathSegments(path);
  if (!clean) return null;
  if (isDrivePath(clean)) return normalizeDrivePath(clean);
  return msysToDrive(clean);
}

function pathSegmentsEqual(a: string, b: string): boolean {
  return (
    toPosix(a).split("/").filter(Boolean).join("/").toLowerCase() ===
    toPosix(b).split("/").filter(Boolean).join("/").toLowerCase()
  );
}

/** Is `child` inside (or equal to) `parent`, drive-aware and case-insensitive? */
export function pathIsUnderLocal(child: string, parent: string): boolean {
  const childSeg = toPosix(child).split("/").filter(Boolean);
  const parentSeg = toPosix(parent).split("/").filter(Boolean);
  if (childSeg.length < parentSeg.length) return false;
  return parentSeg.every((segment, index) =>
    segment.toLowerCase() === childSeg[index].toLowerCase(),
  );
}

function isDotRelative(path: string): boolean {
  return (
    path === "." ||
    path === ".." ||
    path.startsWith("./") ||
    path.startsWith("../") ||
    path.startsWith(".\\") ||
    path.startsWith("..\\")
  );
}

function joinBaseDir(path: string, baseDir?: string | null): string {
  const base = toPosix(baseDir ?? "").replace(/\/+$/, "");
  return base ? `${base}/${toPosix(path)}` : toPosix(path);
}

/**
 * Map a chat-mentioned path onto a workspace-relative path accepted by the
 * fs panel IPC. Absolute paths must live under the workspace root.
 * Unprefixed relative paths are workspace-rooted. `./` and `../` resolve
 * against `baseDir` (the viewed markdown file's directory) when provided,
 * otherwise against the workspace root. `~`, parent escapes, and paths
 * outside the root return null. Windows drive paths resolve against the root
 * case-insensitively when the drive matches.
 */
export function toWorkspaceRel(
  path: string,
  root?: string | null,
  baseDir?: string | null,
): string | null {
  if (!path || path.startsWith("~")) return null;

  const isDrive = isDrivePath(path);
  if (isDrive || toPosix(path).startsWith("/") || MSYS_MOUNT_RE.test(path)) {
    if (!root) return null;
    const workspaceRoot = isDrive ? absoluteLocalPath(root) : null;
    const absolute = isDrive ? absoluteLocalPath(path) : normalizePathSegments(path);
    if (!absolute) return null;
    if (isDrive && (!workspaceRoot || !isDrivePath(workspaceRoot))) return null;
    if (isDrive) {
      if (pathSegmentsEqual(absolute, workspaceRoot!)) return null;
      if (!pathIsUnderLocal(absolute, workspaceRoot!)) return null;
    } else {
      const cleanRoot = toPosix(root).replace(/\/+$/, "");
      if (pathSegmentsEqual(absolute, cleanRoot)) return null;
      if (!pathIsUnderLocal(absolute, cleanRoot)) return null;
    }
    const rootSegments = toPosix(isDrive ? workspaceRoot! : root)
      .split("/")
      .filter(Boolean).length;
    return toPosix(absolute).split("/").filter(Boolean).slice(rootSegments).join("/");
  }

  const relative = isDotRelative(path) ? joinBaseDir(path, baseDir) : path;
  return normalizePathSegments(relative);
}

/**
 * Resolve one chat path: a workspace-relative path when it lives under the
 * workspace root, else an absolute Windows drive/MSYS path marked `external`.
 * Null when the token is neither (including POSIX paths outside the root and
 * `~`).
 */
export function resolveLocalFileRef(
  path: string,
  root?: string | null,
  baseDir?: string | null,
): ChatPreviewTarget | null {
  const rel = toWorkspaceRel(path, root, baseDir);
  if (rel) return { kind: "file", path: rel };
  const absolute = absoluteLocalPath(path);
  return absolute ? { kind: "file", path: absolute, external: true } : null;
}

/** Resolve one raw chat token into a previewable target, or null. */
export function resolvePreviewTarget(
  text: string,
  root?: string | null,
  baseDir?: string | null,
): ChatPreviewTarget | null {
  const trimmed = text.trim();
  if (isHttpUrl(trimmed)) return { kind: "url", url: trimmed };
  const at = unwrapAtFileRef(trimmed);
  if (at) {
    // Scratch/attachment @refs stay absolute so fs/open can contain them.
    if (at.startsWith("/")) return { kind: "file", path: at };
    return resolveLocalFileRef(at, root, baseDir);
  }
  const file = parseFileRef(trimmed);
  if (!file) return null;
  return resolveLocalFileRef(file, root, baseDir);
}

/** Tool-call args → preview target (Read/Write/Edit paths, fetch URLs). */
export function getToolPreviewTarget(
  args: unknown,
  root?: string | null,
): ChatPreviewTarget | null {
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return resolveLocalFileRef(value.trim(), root);
    }
  }
  const url = record["url"];
  if (typeof url === "string" && isHttpUrl(url)) {
    return { kind: "url", url: url.trim() };
  }
  return null;
}
