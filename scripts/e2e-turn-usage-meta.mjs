#!/usr/bin/env node
/** Real Electron/Chromium probe for D436: per-turn usage chips and time chips. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveElectronBinary } from "./e2e/boot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/agent-runtime/package.json"));
const { build } = require("esbuild");
const { electronBinary } = resolveElectronBinary(root);
const temp = await mkdtemp(join(tmpdir(), "pi-turn-usage-meta-"));
try {
  await build({
    entryPoints: [join(root, "scripts/e2e/turn-usage-meta.tsx")],
    outfile: join(temp, "renderer.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "empty" },
    alias: {
      "@pi-desktop/i18n": join(root, "packages/i18n/src/index.ts"),
      react: join(root, "apps/desktop/node_modules/react"),
      "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
    },
    nodePaths: [join(root, "apps/desktop/node_modules")],
  });
  await writeFile(
    join(temp, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>Turn usage meta probe</title><link rel="stylesheet" href="styles.css"><script src="renderer.js"></script>',
  );
  await writeFile(
    join(temp, "styles.css"),
    (
      await Promise.all(
        ["tokens.css", "base.css", "messages.css"].map((name) =>
          readFile(join(root, "apps/desktop/src/styles", name), "utf8"),
        ),
      )
    ).join("\n"),
  );
  await writeFile(
    join(temp, "main.cjs"),
    `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.disableHardwareAcceleration();
app.setPath("userData", path.join(__dirname, "profile"));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 920,
    height: 720,
    webPreferences: { offscreen: true },
  });
  let lastPaint = null;
  window.webContents.on("paint", (_event, _dirty, image) => {
    if (!image.isEmpty()) lastPaint = image;
  });
  window.webContents.setFrameRate(10);
  try {
    await window.loadFile(path.join(__dirname, "index.html"));
    const result = await window.webContents.executeJavaScript("globalThis.turnUsageMetaProbe()");
    await wait(300);
    const image = await new Promise((resolve) => {
      const wc = window.webContents;
      wc.invalidate();
      wc.once("frame-finished", async () => {
        await wait(120);
        resolve(await wc.capturePage());
      });
      setTimeout(() => void wc.capturePage().then(resolve), 3000);
    });
    require("node:fs").writeFileSync(process.env.TURN_USAGE_META_SHOT, image.toPNG());
    const html = await window.webContents.executeJavaScript(
      "document.documentElement.outerHTML",
    );
    require("node:fs").writeFileSync(process.env.TURN_USAGE_META_HTML, html);
    console.log("TURN_USAGE_META_PROBE " + JSON.stringify(result));
    app.quit();
  } catch (error) {
    console.error("TURN_USAGE_META_PROBE " + JSON.stringify({ ok: false, error: String(error) }));
    app.exit(1);
  }
});
`,
  );
  const env = {
    ...process.env,
    TURN_USAGE_META_SHOT: join(temp, "shot.png"),
    TURN_USAGE_META_HTML: join(temp, "demo.html"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [join(temp, "main.cjs")], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      output += data;
    });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 45_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    clearTimeout(timeout);
  }
  const line = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("TURN_USAGE_META_PROBE "));
  assert(
    line,
    `renderer returned no probe result (exit=${code}): ${output.slice(-2000)}`,
  );
  const result = JSON.parse(line.slice("TURN_USAGE_META_PROBE ".length));
  console.log("TURN_USAGE_META_PROBE " + JSON.stringify(result));
  console.log("TURN_USAGE_META_SHOT " + join(temp, "shot.png"));
  assert.equal(code, 0, output.slice(-6000));
  assert.equal(result.ok, true);
} catch (error) {
  console.error("TURN_USAGE_META_SHOT " + join(temp, "shot.png"));
  throw error;
}
