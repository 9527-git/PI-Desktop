import { useCallback } from "react";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import {
  isHtmlFilePath,
  toWorkspaceRel,
  type ChatPreviewTarget,
} from "../lib/chat-links";

/** Open a local path the OS can hand to its associated application. */
export function useOpenLocalPath() {
  const showToast = useAppStore((s) => s.showToast);
  return useCallback(
    (path: string) => {
      void api.fsOpen(path).catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : String(error), {
          variant: "error",
        });
      });
    },
    [showToast],
  );
}

/** Locate a local path in the OS file manager, reporting a failed handoff. */
export function useRevealLocalPath() {
  const showToast = useAppStore((s) => s.showToast);
  return useCallback(
    (path: string) => {
      void api.fsReveal(path).catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : String(error), {
          variant: "error",
        });
      });
    },
    [showToast],
  );
}

/**
 * Open a resolved chat reference: workspace files in the work-panel viewer,
 * files outside the workspace with the OS default handler, URLs in the
 * embedded browser. Shared by the transcript's tool row summaries and tool
 * result file/match lists.
 */
export function useOpenPreviewTarget() {
  const openFile = useAppStore((s) => s.openFileInWorkPanel);
  const openUrl = useAppStore((s) => s.openUrlInWorkPanel);
  const openLocalPath = useOpenLocalPath();
  return useCallback(
    (target: ChatPreviewTarget) => {
      if (target.kind !== "file") {
        openUrl(target.url);
        return;
      }
      // An absolute path outside the workspace has no work-panel viewer: the
      // host hands it to the OS (D424 / ADR 0256).
      if (target.external) openLocalPath(target.path);
      else openFile(target.path);
    },
    [openFile, openLocalPath, openUrl],
  );
}

/**
 * Open a user-message file chip: workspace HTML in the side browser, every
 * other allowed path with the OS default handler (D320).
 */
export function useOpenChatFileRef() {
  const workspacePath = useAppStore((s) => s.workspace?.path ?? null);
  const openUrl = useAppStore((s) => s.openUrlInWorkPanel);
  const openLocalPath = useOpenLocalPath();
  return useCallback(
    (path: string) => {
      const rel = toWorkspaceRel(path, workspacePath);
      if (rel && isHtmlFilePath(rel)) {
        openUrl(rel);
        return;
      }
      openLocalPath(path);
    },
    [openLocalPath, openUrl, workspacePath],
  );
}
