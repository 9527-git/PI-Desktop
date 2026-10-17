/**
 * In-app quit and close-behavior confirmation (D452, D469).
 *
 * The main process pushes a request and suspends shutdown until the renderer
 * answers with exactly one choice. The renderer acknowledges the request once
 * the dialog is on screen, so main can tell "the user is still deciding" from
 * "no dialog can be drawn". A `null` answer is never sent by the renderer: it is
 * the main-side sentinel for "the renderer could not answer", and the caller
 * then applies its own default — nothing draws a native message box anymore.
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

/** Renderer's proof that the request reached a dialog the user can answer. */
export type QuitDialogPresent = {
  requestId: string;
};

/** Main giving up on a request whose dialog is no longer answerable. */
export type QuitDialogDismiss = {
  requestId: string;
};

export type QuitDialogResponse = {
  requestId: string;
  choice: QuitDialogChoice;
};
