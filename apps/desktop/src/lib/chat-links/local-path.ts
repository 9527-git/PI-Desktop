/**
 * Positional helpers for *local* absolute paths: canonicalizing Windows drive
 * (`E:\dir\file.ts`) and MSYS/Git-Bash mount (`/e/dir`) forms, and comparing
 * two paths segment-wise for containment. Extracted from `resolve.ts` so both
 * files stay small; the workspace root is always passed in by the caller.
 *
 * Pure string work — nothing here reads the filesystem or decides policy.
 */

import {
  MSYS_MOUNT_RE,
  isDrivePath,
  isWindowsHost,
  normalizePathSegments,
  toPosix,
} from "./path-shape";

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

/** Same location after separator unification and case folding? */
export function pathSegmentsEqual(a: string, b: string): boolean {
  const join = (value: string) => toPosix(value).split("/").filter(Boolean).join("/");
  return join(a).toLowerCase() === join(b).toLowerCase();
}

/** Is `child` inside (or equal to) `parent`, drive-aware and case-insensitive? */
export function pathIsUnderLocal(child: string, parent: string): boolean {
  const childSeg = toPosix(child).split("/").filter(Boolean);
  const parentSeg = toPosix(parent).split("/").filter(Boolean);
  if (childSeg.length < parentSeg.length) return false;
  return parentSeg.every(
    (segment, index) => segment.toLowerCase() === childSeg[index].toLowerCase(),
  );
}
