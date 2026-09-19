import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import {
  IPC,
  type QuitDialogChoice,
  type QuitDialogKind,
  type QuitDialogRequest,
  type QuitDialogResponse,
} from "@pi-desktop/shared";

/**
 * A hung, reloading, or already-gone renderer must never hold shutdown
 * hostage: past this budget the caller drops to the native message box.
 */
export const QUIT_DIALOG_TIMEOUT_MS = 5_000;

type PendingQuitDialog = {
  resolve: (choice: QuitDialogChoice | null) => void;
  timer: NodeJS.Timeout;
};

export type QuitDialogRuntimeDependencies = {
  getWindow: () => BrowserWindow | null;
  getRunningTurns: () => number;
  send: (channel: string, payload: unknown) => void;
};

/**
 * Main side of the in-app quit / close-behavior dialog (D452). Mirrors the
 * extension prompt bridge: one pending promise per request id, settled either
 * by the renderer's reply or by the timeout's null sentinel.
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
    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.resolve(choice);
  };

  /** Resolves `null` when the renderer cannot answer, so callers fall back. */
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
      const timer = setTimeout(
        () => settle(requestId, null),
        QUIT_DIALOG_TIMEOUT_MS,
      );
      pending.set(requestId, { resolve, timer });
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

  const respond = (response: QuitDialogResponse): void => {
    settle(response.requestId, response.choice);
  };

  return { request, respond, pendingCount: () => pending.size };
}
