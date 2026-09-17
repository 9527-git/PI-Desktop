#!/usr/bin/env node
/** Real React/Chromium regression for non-destructive individual model selection. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveElectronBinary } from "./e2e/boot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/agent-runtime/package.json"));
const { build } = require("esbuild");
const { electronBinary } = resolveElectronBinary(root);
const temp = await mkdtemp(join(tmpdir(), "pi-provider-model-selection-"));
const marker = "PROVIDER_MODEL_SELECTION_PROBE ";
let child;
let interrupted = false;
const terminate = () => { if (child?.exitCode === null && !child.killed) child.kill("SIGKILL"); };
const interrupt = () => { interrupted = true; terminate(); };
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
process.once("exit", terminate);
try {
  await build({
    entryPoints: [join(root, "scripts/e2e/provider-model-selection.ts")],
    outfile: join(temp, "renderer.js"), bundle: true, platform: "browser",
    format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    alias: {
      "@pi-desktop/i18n": join(root, "packages/i18n/src/index.ts"),
      "@pi-desktop/shared": join(root, "packages/shared/src/index.ts"),
      react: join(root, "apps/desktop/node_modules/react"),
      "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
    },
    nodePaths: [join(root, "apps/desktop/node_modules")],
  });
  await writeFile(join(temp, "index.html"),
    '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'"><link rel="stylesheet" href="renderer.css"><title>Provider model selection regression</title><body><script src="renderer.js"></script>');
  await writeFile(join(temp, "main.cjs"), `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.setPath("logs", path.join(__dirname, "logs"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1200, height: 1000,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.on("console-message", (event) => console.error(event.message));
  const evaluate = (code) => window.webContents.executeJavaScript("globalThis.providerModelSelectionProbe." + code);
  try {
    await window.loadFile(path.join(__dirname, "index.html"));
    await evaluate("setup()");
    await evaluate("verifyCheckbox()");
    window.webContents.debugger.attach("1.3");
    for (const kind of ["id", "name", "limits", "padding", "checkbox", "checkbox"]) {
      const point = await evaluate("point(" + JSON.stringify(kind) + ")");
      await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
      await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
      await evaluate("verifyNative()");
    }
    await evaluate("focusCheckbox()");
    await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await evaluate("verifyKeyboard()");
    const result = await evaluate("run()");
    console.log(${JSON.stringify(marker)} + JSON.stringify(result));
    app.quit();
  } catch (error) {
    console.error(${JSON.stringify(marker)} + JSON.stringify({ ok: false, error: String(error) }));
    app.exit(1);
  }
});
`);
  if (interrupted) throw new Error("Provider model selection probe interrupted");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronBinary, [join(temp, "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { output += data; });
  const timeout = setTimeout(terminate, 45_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally { clearTimeout(timeout); }
  const line = output.split(/\r?\n/).find((line) => line.startsWith(marker));
  assert(line, `renderer returned no probe result (exit=${code}): ${output.slice(-4000)}`);
  const result = JSON.parse(line.slice(marker.length));
  console.log(marker + JSON.stringify(result));
  assert.equal(code, 0, output.slice(-6000));
  assert.equal(result.ok, true);
  assert.equal(result.scenarios?.length, 16, "a provider selection scenario did not run");
  assert.equal(new Set(result.scenarios).size, 16, "duplicate provider selection scenario");
} finally {
  terminate();
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  process.off("exit", terminate);
  try { await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (error) {
    console.error(`Provider probe cleanup failed (${temp}):`, error);
    process.exitCode = 1;
  }
}
