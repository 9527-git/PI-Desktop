/**
 * Containment gates for chat-referenced paths that leave the workspace: the
 * user-initiated OS handoff behind `fs/open` and `fs/reveal`, and the
 * existence probe behind `fs/stat` (ADR 0256 / ADR 0257).
 *
 * The workspace-scoped resolvers stay in `fs-panel`; this module only adds the
 * gate for a *user click*. `resolveLooseOpenablePath` accepts any existing
 * local absolute path, minus protected roots (the app data directory with its
 * databases and credentials), so a path the conversation mentions can be
 * opened or located like a double-clicked file. The difference between
 * "hand off to the OS" and "read into the app" is the load-bearing one:
 * `fs/read`, `fs/list`, `fs/index`, and every agent-tool gate keep their
 * existing workspace-scoped containment, and none of them consumes this file.
 *
 * The shell handoff is injected instead of imported so the gates stay loadable
 * (and testable) outside Electron.
 */

import { realpathSync, statSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { FsPathStat } from "@pi-desktop/shared";
import { pathIsWithin, resolveRealOpenablePath } from "./fs-panel";
import { stripWinLongPrefix } from "./path-utils";

/** The slice of Electron's `shell` the reveal handoff needs. */
export type RevealShell = {
  openPath: (path: string) => Promise<string>;
  showItemInFolder: (path: string) => void;
};

/**
 * Containment for the *open/reveal* actions on a chat-referenced path that
 * lives outside the workspace and the extra roots (ADR 0256).
 *
 * The action is a user-initiated OS handoff — the same as double-clicking the
 * file in a file manager — so it may address any existing local absolute path.
 * The guard is still real: the token must be absolute, the target must exist
 * and resolve through links, and protected roots are refused. `fs/read` never
 * uses this function; its containment stays workspace-scoped.
 */
export async function resolveLooseOpenablePath(
  path: string,
  protectedRoots: readonly string[] = [],
): Promise<string | null> {
  const raw = String(path ?? "").trim();
  if (!raw || raw.startsWith("~")) return null;
  // Only absolute local paths qualify: a drive prefix, or a POSIX-absolute
  // path (an MSYS mount resolves through the same realpath on Windows).
  if (!isAbsolute(raw) && !/^[A-Za-z]:[\\/]/.test(raw)) return null;
  let target: string;
  try {
    target = await realpath(resolve(raw));
  } catch {
    return null;
  }
  const insideProtected = protectedRoots.some((root) => {
    try {
      return pathIsWithin(realpathSync(resolve(root)), target);
    } catch {
      return false;
    }
  });
  return insideProtected ? null : target;
}

/**
 * Hand `target` to the OS file manager so the action is always visible: a file
 * is selected in its folder, a directory opens, and a target that disappeared
 * between the containment check and the reveal falls back to its nearest
 * existing ancestor. `showItemInFolder` alone is a silent no-op in those
 * cases, which reads as a dead button.
 */
export function revealTarget(target: string, shell: RevealShell): void {
  const native = stripWinLongPrefix(target);
  try {
    if (statSync(native).isDirectory()) {
      void shell.openPath(native);
      return;
    }
    shell.showItemInFolder(native);
    return;
  } catch {
    // Fall through: the entry is gone, so show whatever still exists.
  }
  let cursor = dirname(native);
  for (;;) {
    try {
      if (statSync(cursor).isDirectory()) {
        void shell.openPath(stripWinLongPrefix(cursor));
        return;
      }
    } catch {
      // Keep walking up.
    }
    const parent = dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

/**
 * Report whether a referenced path still resolves to something on disk
 * (ADR 0257).
 *
 * Only the verdict leaves main: no content, no size, no directory listing. A
 * path outside the allowed roots reports `exists: false`, which is the correct
 * answer for a transcript row — it cannot open or reveal that path either, so
 * the row is dead the same way a deleted file is.
 */
export async function statOpenablePath(
  path: string,
  workspaceRoot: string | null | undefined,
  extraRoots: readonly string[] = [],
  protectedRoots: readonly string[] = [],
): Promise<FsPathStat> {
  const target =
    (await resolveRealOpenablePath(path, workspaceRoot, extraRoots)) ??
    (await resolveLooseOpenablePath(path, protectedRoots));
  if (!target) return { exists: false, kind: null };
  try {
    const info = await stat(target);
    return {
      exists: true,
      kind: info.isDirectory() ? "dir" : "file",
    };
  } catch {
    return { exists: false, kind: null };
  }
}
