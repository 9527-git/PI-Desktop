/**
 * Actions on a chat-referenced path: the bounded read used by the viewer and
 * in-chat images, plus the existence probe the transcript uses to mark a
 * reference whose file is gone.
 *
 * Every action consumes a resolver from `fs-open-gate`, so the containment
 * rules live in one place: reads stay workspace-scoped, the probe additionally
 * accepts an outside absolute path through the OS-handoff gate (ADR 0236 /
 * 0237).
 */

import { stat } from "node:fs/promises";
import type { FsImageDataUrlResult, FsReadResult } from "@pi-desktop/shared";
import { previewFile } from "./fs-panel";
import {
  resolveLooseOpenablePath,
  resolveRealOpenablePath,
} from "./fs-open-gate";

/** What an existence probe reports for one path. */
export type OpenablePathStat = {
  exists: boolean;
  kind: "file" | "dir" | null;
};

/**
 * Read a workspace file, a content-addressed `attachments/<sha256>` blob, or
 * an absolute path already inside scratch/attachments. Containment matches
 * `fs/open` (D320) plus a realpath check.
 */
export async function readOpenableFile(
  path: string,
  workspaceRoot: string | null | undefined,
  extraRoots: readonly string[],
  mimeType?: string,
): Promise<FsReadResult> {
  const target = await resolveRealOpenablePath(path, workspaceRoot, extraRoots);
  if (!target) throw new Error("path outside allowed roots");
  const info = await stat(target);
  if (!info.isFile()) throw new Error("not a file");
  return previewFile(target, path, mimeType);
}

/**
 * Bounded image data URL for in-chat display. Never returns file bytes for
 * non-images, so a markdown `![](secret.txt)` cannot dump text into the
 * renderer cache.
 */
export async function readOpenableImage(
  path: string,
  workspaceRoot: string | null | undefined,
  extraRoots: readonly string[],
  mimeType?: string,
): Promise<FsImageDataUrlResult> {
  const target = await resolveRealOpenablePath(path, workspaceRoot, extraRoots);
  if (!target) {
    return { kind: "missing", errorCode: "PATH_OUTSIDE_ALLOWED_ROOT" };
  }
  try {
    const result = await previewFile(target, path, mimeType);
    if (result.kind === "image" && result.dataUrl) {
      return { kind: "image", dataUrl: result.dataUrl, size: result.size };
    }
    if (result.kind === "tooLarge") {
      return { kind: "tooLarge", size: result.size, errorCode: "IMAGE_TOO_LARGE" };
    }
    return { kind: "notImage", size: result.size, errorCode: "NOT_AN_IMAGE" };
  } catch {
    return { kind: "missing", errorCode: "FILE_NOT_FOUND" };
  }
}

/**
 * Report whether a referenced path still resolves to something on disk.
 *
 * Only the verdict leaves main: no content, no size, no directory listing.
 * A path outside the allowed roots reports `exists: false`, which is the
 * correct answer for the transcript — it cannot open or reveal that path
 * either, so the row is dead the same way a deleted file is.
 */
export async function statOpenablePath(
  path: string,
  workspaceRoot: string | null | undefined,
  extraRoots: readonly string[] = [],
  protectedRoots: readonly string[] = [],
): Promise<OpenablePathStat> {
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
