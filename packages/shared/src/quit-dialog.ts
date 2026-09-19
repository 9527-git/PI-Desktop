/**
 * In-app quit and close-behavior confirmation (D452).
 *
 * The main process pushes a request and suspends shutdown until the renderer
 * answers with exactly one choice. A `null` answer is never sent by the
 * renderer: it is the main-side sentinel for "the renderer could not answer",
 * which makes the caller fall back to the native message box.
 */
export type QuitDialogKind = "quit-confirm" | "close-ask";

/**
 * "confirm" / "cancel" belong to `quit-confirm`; "tray" / "quit" / "cancel"
 * belong to `close-ask`. One flat union keeps the response channel trivial.
 */
export type QuitDialogChoice = "confirm" | "cancel" | "tray" | "quit";

export type QuitDialogRequest = {
  requestId: string;
  kind: QuitDialogKind;
  /** Sessions still streaming; only rendered for `quit-confirm`. */
  runningTurns: number;
};

export type QuitDialogResponse = {
  requestId: string;
  choice: QuitDialogChoice;
};
