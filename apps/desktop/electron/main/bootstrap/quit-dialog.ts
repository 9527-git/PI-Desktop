import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import {
  IPC,
  type QuitDialogChoice,
  type QuitDialogDismiss,
  type QuitDialogKind,
  type QuitDialogPresent,
  type QuitDialogRequest,
  type QuitDialogResponse,
} from "@pi-desktop/shared";

/**
 * How long the renderer has to prove it can draw the confirmation. A hung,
 * reloading, or already-gone renderer must never hold shutdown hostage: past
 * this budget the request settles as unanswered and the caller applies its own
 * default (D469). The budget measures the renderer's ability to present the
 * dialog, never the user's reading speed — once the renderer acknowledges, the
 * user may take as long as they need.
 */
export const QUIT_DIALOG_PRESENT_TIMEOUT_MS = 10_000;

type PendingQuitDialog = {
  resolve: (choice: QuitDialogChoice | null) => void;
  /** Cleared once the renderer acknowledges the dialog is on screen. */
  timer: NodeJS.Timeout | null;
};

export type QuitDialogRuntimeDependencies = {
  getWindow: () => BrowserWindow | null;
  getRunningTurns: () => number;
  send: (channel: string, payload: unknown) => void;
};

/**
 * Main side of the in-app quit / close-behavior dialog (D452). Mirrors the
 * extension prompt bridge: one pending promise per request id, settled by the
 * renderer's reply, by the acknowledgement never arriving, or by a stale
 * request being abandoned. D469 removed the native message box, so the OS can
 * never draw a second confirmation over the renderer's dialog.
 */
export function createQuitDialogRuntime({
  getWindow,
  getRunningTurns,
  send,
}: QuitDialogRuntimeDependencies) {
  const pending = new Map<string, PendingQuitDialog>();

  const settle = (requestId: string, choice: QuitDialogChoice | null): void => {
    const entry = pending.get(requestId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.resolve(choice);
  };

  /** Resolves `null` when the renderer cannot answer, so callers keep a default. */
  const request = (kind: QuitDialogKind): Promise<QuitDialogChoice | null> => {
    const window = getWindow();
    if (
      !window ||
      window.isDestroyed() ||
      window.webContents.isDestroyed() ||
      window.webContents.isLoading()
    ) {
      return Promise.resolve(null);
    }
    const requestId = randomUUID();
    return new Promise<QuitDialogChoice | null>((resolve) => {
      const entry: PendingQuitDialog = { resolve, timer: null };
      entry.timer = setTimeout(() => {
        settle(requestId, null);
        // A renderer that was too busy to answer may still mount the dialog
        // later, so the abandoned request is retracted instead of left to sit
        // on screen without a pending answer.
        const dismiss: QuitDialogDismiss = { requestId };
        send(IPC.event.quitDialogDismiss, dismiss);
      }, QUIT_DIALOG_PRESENT_TIMEOUT_MS);
      pending.set(requestId, entry);
      // A tray-resident window is hidden; the user must see what they confirm.
      if (!window.isVisible()) window.show();
      window.focus();
      const payload: QuitDialogRequest = {
        requestId,
        kind,
        runningTurns: getRunningTurns(),
      };
      send(IPC.event.quitDialogRequest, payload);
    });
  };

  /** The dialog is on screen, so only the user's answer is still outstanding. */
  const present = (signal: QuitDialogPresent): void => {
    const entry = pending.get(signal.requestId);
    if (!entry || !entry.timer) return;
    clearTimeout(entry.timer);
    entry.timer = null;
  };

  const respond = (response: QuitDialogResponse): void => {
    settle(response.requestId, response.choice);
  };

  return { request, present, respond, pendingCount: () => pending.size };
}
