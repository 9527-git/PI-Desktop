import type { CloseBehavior } from "@pi-desktop/shared";
import {
  readCloseBehavior,
  writeCloseBehavior,
} from "../window-preferences";
import type { WindowLifecycleState } from "./window";
import type { createQuitDialogRuntime } from "./quit-dialog";

export type CloseBehaviorDependencies = {
  state: WindowLifecycleState;
  dataDir: string;
  createTray: () => void;
  quitDialog: ReturnType<typeof createQuitDialogRuntime>;
};

export function createCloseBehaviorRuntime({
  state,
  dataDir,
  createTray,
  quitDialog,
}: CloseBehaviorDependencies) {
  const applyCloseBehavior = (next: CloseBehavior): void => {
    state.closeBehavior = next;
    writeCloseBehavior(dataDir, next);
    if (next === "tray") createTray();
  };

  // D452/D469: the renderer draws both confirmations so they stay anchored to
  // the window and can show what is actually running. Nothing on this path
  // opens a native message box, so the OS can never stack a second dialog over
  // the renderer's one; `null` means "no dialog could be shown" and each caller
  // below decides what that leaves it with.
  const askCloseBehavior = async (): Promise<"tray" | "quit" | null> => {
    const choice = await quitDialog.request("close-ask");
    if (choice === "tray") return "tray";
    if (choice === "quit") return "quit";
    // Canceled by the user, or never shown by an unresponsive renderer: keep
    // the window open and leave the preference unset. The tray menu and the
    // application menu still quit, and an unanswered quit-confirm proceeds.
    return null;
  };

  const confirmQuitDialog = async (): Promise<boolean> => {
    const choice = await quitDialog.request("quit-confirm");
    // The user already asked to quit; with no dialog available there is no
    // confirmation left to collect, and an app that can never be quit is worse
    // than one that skips its warning. Cancelling still keeps it running.
    return choice === null || choice === "confirm";
  };

  return {
    applyCloseBehavior,
    askCloseBehavior,
    confirmQuitDialog,
    readCloseBehavior: () => readCloseBehavior(dataDir),
  };
}
