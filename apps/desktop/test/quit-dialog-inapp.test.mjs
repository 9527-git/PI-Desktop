import {
  readMainSource,
  readMainModule,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const mainSource = await readMainSource();
const closeBehaviorSource = await readMainModule("bootstrap/close-behavior.ts");
const quitDialogSource = await readMainModule("bootstrap/quit-dialog.ts");
const protocolSource = await readFile(
  new URL("../../../packages/shared/src/protocol.ts", import.meta.url),
  "utf8",
);
const hostSource = await readFile(
  new URL("../src/components/QuitDialogHost.tsx", import.meta.url),
  "utf8",
);

test("close-behavior routes both dialogs through the in-app runtime with no native box", () => {
  // D452 moved both confirmations into the renderer. D469 removed the native
  // message box that used to race the in-app dialog: the five-second budget it
  // waited on measured the user's reading speed, so anyone who paused produced
  // a native warning stacked over the dialog they were still reading.
  assert.doesNotMatch(closeBehaviorSource, /showMessageBox/);
  assert.doesNotMatch(mainSource, /nativeAskCloseBehavior/);
  assert.doesNotMatch(mainSource, /nativeConfirmQuitDialog/);
  assert.match(
    closeBehaviorSource,
    /await quitDialog\.request\("close-ask"\)/,
    "askCloseBehavior uses the runtime",
  );
  assert.match(
    closeBehaviorSource,
    /await quitDialog\.request\("quit-confirm"\)/,
    "confirmQuitDialog uses the runtime",
  );
});

test("an unanswered request falls through to the caller's own default", () => {
  // With no native box left, a renderer that cannot draw the dialog must not
  // turn into an app that cannot be quit, and must not invent a close
  // preference the user never chose.
  assert.match(
    closeBehaviorSource,
    /const askCloseBehavior = async \(\)[^]*?return null;\n {2}\};/,
    "close-ask without an answer keeps the window open",
  );
  const ask = closeBehaviorSource.slice(
    closeBehaviorSource.indexOf("const askCloseBehavior"),
    closeBehaviorSource.indexOf("const confirmQuitDialog"),
  );
  assert.doesNotMatch(
    ask,
    /applyCloseBehavior/,
    "an unanswered close-ask persists nothing",
  );
  assert.match(
    closeBehaviorSource,
    /return choice === null \|\| choice === "confirm";/,
    "quit-confirm without an answer still quits",
  );
});

test("main waits for the renderer's presentation ack, not for a human", () => {
  // The budget answers "can the renderer draw this?", so a slow user never
  // trips it; only a renderer that cannot present the dialog does.
  assert.match(quitDialogSource, /QUIT_DIALOG_PRESENT_TIMEOUT_MS = 10_000/);
  assert.match(
    quitDialogSource,
    /const present = \(signal: QuitDialogPresent\)[^]*?clearTimeout\(entry\.timer\)/,
    "the acknowledgement clears the presentation budget",
  );
  assert.match(
    quitDialogSource,
    /settle\(requestId, null\);[^]*?IPC\.event\.quitDialogDismiss/,
    "giving up retracts the request instead of leaving a dead dialog up",
  );
});

test("the renderer acknowledges the dialog it shows and drops what main retracts", () => {
  assert.match(
    hostSource,
    /api\.presentQuitDialog\(\{ requestId: next\.requestId \}\)/,
    "the host acknowledges the request it renders",
  );
  assert.match(hostSource, /api\.onQuitDialogDismiss/);
  assert.match(
    hostSource,
    /if \(activeRequestId\.current\) return;/,
    "an unshown request is never acknowledged, or main would wait forever",
  );
});

test("the IPC channels are whitelisted in the shared protocol registry", () => {
  assert.match(
    protocolSource,
    /quitDialogRespond:\s*"pi-desktop\/app\/quitDialog\/respond"/,
  );
  assert.match(
    protocolSource,
    /quitDialogPresent:\s*"pi-desktop\/app\/quitDialog\/present"/,
  );
  assert.match(
    protocolSource,
    /quitDialogRequest:\s*"pi-desktop\/app\/event\/quitDialogRequest"/,
  );
  assert.match(
    protocolSource,
    /quitDialogDismiss:\s*"pi-desktop\/app\/event\/quitDialogDismiss"/,
  );
  // Whitelist is built from Object.values(IPC.invoke) + Object.values(IPC.event).
  assert.match(protocolSource, /IPC_WHITELIST.*Object\.values\(IPC\.invoke\).*Object\.values\(IPC\.event\)/s);
});
