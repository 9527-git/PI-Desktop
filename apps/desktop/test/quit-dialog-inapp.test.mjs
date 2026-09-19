import {
  readMainSource,
  readMainModule,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mainSource = await readMainSource();
const closeBehaviorSource = await readMainModule("bootstrap/close-behavior.ts");
const quitDialogSource = await readMainModule("bootstrap/quit-dialog.ts");
const protocolSource = await readFile(
  new URL("../packages/shared/src/protocol.ts", import.meta.url),
  "utf8",
);

test("close-behavior routes both dialogs through the in-app runtime with native fallback", () => {
  // D452: askCloseBehavior and confirmQuitDialog are wrappers around the runtime;
  // native implementations live as fallbacks.
  assert.match(closeBehaviorSource, /const nativeAskCloseBehavior = async/);
  assert.match(closeBehaviorSource, /const nativeConfirmQuitDialog = async/);
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
  assert.match(
    closeBehaviorSource,
    /if \(choice === null\) return nativeAskCloseBehavior/,
    "native fallback for close-ask",
  );
  assert.match(
    closeBehaviorSource,
    /if \(choice === null\) return nativeConfirmQuitDialog/,
    "native fallback for quit-confirm",
  );
});

test("the quit dialog runtime has a bounded timeout that resolves to null (fallback sentinel)", () => {
  // D452: a hung or gone renderer must never hold shutdown hostage.
  assert.match(quitDialogSource, /QUIT_DIALOG_TIMEOUT_MS = 5_000/);
  const requestMatch = quitDialogSource.match(
    /setTimeout\(\s*\(\) => settle\(requestId, null\),\s*QUIT_DIALOG_TIMEOUT_MS\s*\)/,
  );
  assert.ok(requestMatch, "timeout settles with null sentinel");
});

test("the IPC channels are whitelisted in the shared protocol registry", () => {
  // D452: both push and respond channels are registered and whitelisted.
  assert.match(
    protocolSource,
    /quitDialogRespond:\s*"pi-desktop\/app\/quitDialog\/respond"/,
  );
  assert.match(
    protocolSource,
    /quitDialogRequest:\s*"pi-desktop\/app\/event\/quitDialogRequest"/,
  );
  // Whitelist is built from Object.values(IPC.invoke) + Object.values(IPC.event).
  assert.match(protocolSource, /IPC_WHITELIST.*Object\.values\(IPC\.invoke\).*Object\.values\(IPC\.event\)/s);
});
