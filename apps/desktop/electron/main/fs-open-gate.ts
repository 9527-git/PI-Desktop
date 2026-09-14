/**
 * Containment gates for the OS handoff actions on chat-referenced paths:
 * opening a file with its associated application and revealing it in the
 * file manager (ADR 0109 / 0111 / 0236).
 *
 * Split from `fs-panel` so the panel's read/browse surface keeps its strict
 * workspace scope while these user-initiated handoffs carry their own,
 * documented gate.
 */

import { realpathSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { stat } from "node:fs/promises";
import type { FsImageDataUrlResult, FsReadResult } from "@pi-desktop/shared";
import {
  isAttachmentBlobRef,
  pathIsWithin,
  previewFile,
  resolveWithinRoot,
} from "./fs-panel";
import { realpath } from "node:fs/promises";

/**
 * Resolve a user-clicked chat file path against the workspace plus extra
 * containment roots (session scratch, attachments). Relative paths resolve
 * only inside the workspace; absolute paths must already live under one of
 * the allowed roots.
 */
export function resolveOpenablePath(
  path: string,
  workspaceRoot: string | null | undefined,
  extraRoots: readonly string[] = [],
): string | null {
  const raw = String(path ?? "").trim();
  if (!raw || raw.startsWith("~")) return null;

  const allowed = [
    ...(workspaceRoot ? [resolve(workspaceRoot)] : []),
    ...extraRoots
      .filter((root) => typeof root === "string" && root.trim())
      .map((root) => resolve(root)),
  ];
  if (allowed.length === 0) return null;

  let candidate: string;
  if (isAttachmentBlobRef(raw)) {
    const extraResolved = extraRoots
      .filter((root) => typeof root === "string" && root.trim())
      .map((root) => resolve(root));
    const attachmentRoot = extraResolved.find((root) => basename(root) === "attachments");
    if (!attachmentRoot) return null;
    const relativePath = resolveWithinRoot(
      attachmentRoot,
      raw.replace(/\\/g, "/").slice("attachments/".length),
    );
    if (!relativePath) return null;
    candidate = relativePath;
  } else if (isAbsolute(raw)) {
    candidate = resolve(raw);
  } else {
    if (!workspaceRoot) return null;
    const relativePath = resolveWithinRoot(workspaceRoot, raw);
    if (!relativePath) return null;
    candidate = relativePath;
  }

  return allowed.some((root) => pathIsWithin(root, candidate)) ? candidate : null;
}

/**
 * Same containment as `resolveOpenablePath`, then `realpath` so a symlink
 * inside an allowed root cannot be used to read a file outside it.
 */
export async function resolveRealOpenablePath(
  path: string,
  workspaceRoot: string | null | undefined,
  extraRoots: readonly string[] = [],
): Promise<string | null> {
  const lexical = resolveOpenablePath(path, workspaceRoot, extraRoots);
  if (!lexical) return null;
  const allowed = [
    ...(workspaceRoot ? [resolve(workspaceRoot)] : []),
    ...extraRoots
      .filter((root) => typeof root === "string" && root.trim())
      .map((root) => resolve(root)),
  ];
  try {
    const targetReal = await realpath(lexical);
    const realRoots = await Promise.all(
      allowed.map(async (root) => {
        try {
          return await realpath(root);
        } catch {
          return null;
        }
      }),
    );
    return realRoots.some((root) => root && pathIsWithin(root, targetReal))
      ? targetReal
      : null;
  } catch {
    return null;
  }
}

/**
 * Containment for the *open/reveal* actions on a chat-referenced path that
 * lives outside the workspace and the extra roots (ADR 0236).
 *
 * The action is a user-initiated OS handoff — the same as double-clicking the
 * file in a file manager — so it may address any existing local absolute
 * path. The guard is still real: the token must be absolute, the target must
 * exist and resolve through links, and protected roots (the app data
 * directory with its databases and credentials) are refused. `fs/read` never
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
  if (!isAbsolute(raw) && !/^[A-Za-z]:[\/]/.test(raw)) return null;
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
