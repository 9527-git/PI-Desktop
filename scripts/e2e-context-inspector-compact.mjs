#!/usr/bin/env node
/**
 * E2E-CHAT-compact-from-context-inspector.
 *
 * Launches the built desktop app with a throwaway profile and drives the
 * renderer over CDP: seeds the inspector fixture, opens the context popover,
 * clicks the compact action, and asserts the contract:
 *
 *   - idle: the action row carries a hint and an enabled button;
 *   - open: focus moves into the portaled panel, so the action is reachable;
 *   - click: `api.compact` receives the active session id and the popover
 *     stays open — the card is both the trigger and the result surface;
 *   - busy: the runtime's `compacting` activity disables the button and swaps
 *     the label and hint;
 *   - blocked: a running session disables the button without the busy state;
 *   - the checkpoint line renders the pre-compaction occupancy only when the
 *     mark carries it; a legacy mark degrades to the single line.
 *
 * Prereqs: `pnpm build:js` and `pnpm --filter @pi-desktop/desktop build`, plus
 * a host-core binary (target/debug, target/release, or PI_DESKTOP_HOST_BIN).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertDesktopBuild,
  createTempDataDir,
  repositoryRoot,
  resolveElectronBinary,
} from "./e2e/boot.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";

const root = repositoryRoot();
const cdpPort = Number(process.env.PI_DESKTOP_INSPECTOR_CDP_PORT || 9341);
const { appDir, electronBinary } = resolveElectronBinary(root);

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.console = [];
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (
        message.method === "Runtime.consoleAPICalled" ||
        message.method === "Runtime.exceptionThrown"
      ) {
        this.console.push(
          `[${message.method}] ${JSON.stringify(message.params).slice(0, 400)}`,
        );
        if (this.console.length > 40) this.console.shift();
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    };
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onerror = () => reject(new Error(`CDP websocket failed: ${url}`));
      ws.onopen = () => resolve(new CdpClient(ws));
    });
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          JSON.stringify(result.exceptionDetails),
      );
    }
    return result.result.value;
  }
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2_000),
  });
  return response.json();
}

async function waitFor(predicate, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(
    `timeout waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`,
  );
}

const READ_ROW = `(() => {
  const row = document.querySelector(".context-inspector-actions");
  const button = document.querySelector(".context-inspector-compact-action");
  const before = document.querySelector(".context-inspector-compaction-before");
  return {
    popoverOpen: !!document.querySelector(".context-inspector-popover"),
    row: !!row,
    hint: row?.querySelector(".context-inspector-actions-hint")?.textContent?.trim() ?? null,
    label: button?.textContent?.trim() ?? null,
    disabled: button ? button.disabled : null,
    ariaBusy: button?.getAttribute("aria-busy") ?? null,
    spinner: !!button?.querySelector(".tool-spinner"),
    before: before ? before.textContent.trim() : null,
    compactionRows: document.querySelectorAll(".context-inspector-compaction").length,
  };
})()`;

const results = [];
function check(ok, label, detail = "") {
  results.push({ ok, label, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

let activeCdp = null;

async function main() {
  assertDesktopBuild(root);
  const hostBinary = resolveHostBinary();
  const dataDir = createTempDataDir("pi-inspector-data-");
  const profileDir = mkdtempSync(join(tmpdir(), "pi-inspector-profile-"));
  const child = spawn(
    electronBinary,
    [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, "."],
    {
      cwd: appDir,
      env: {
        ...process.env,
        PI_DESKTOP_DATA_DIR: dataDir,
        PI_DESKTOP_HOST_BIN: hostBinary,
        PI_DESKTOP_START_MAXIMIZED: "0",
        ELECTRON_RENDERER_URL: "",
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const collect = (chunk) => {
    output += String(chunk);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  const cleanup = () => {
    try {
      if (process.platform === "win32" || !child.pid) child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch {}
    for (const dir of [dataDir, profileDir]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  };

  const timeout = setTimeout(() => {
    console.error("FAIL inspector compact — timeout after 180s");
    console.error(output.slice(-2_000));
    cleanup();
    process.exit(1);
  }, 180_000);

  try {
    const target = await waitFor(async () => {
      const targets = await listTargets(cdpPort).catch(() => []);
      return targets.find(
        (candidate) =>
          candidate.type === "page" &&
          candidate.webSocketDebuggerUrl &&
          candidate.url.includes("out/renderer/index.html") &&
          !candidate.url.includes("surface="),
      );
    }, "main window CDP target");

    const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    activeCdp = cdp;
    await cdp.send("Runtime.enable");
    const evaluate = (expression) => cdp.evaluate(expression);
    const seed = async (options) => {
      await waitFor(
        () =>
          evaluate(
            `typeof window.__PI_DESKTOP__?.seedContextInspectorCompaction === "function"`,
          ),
        "capture rig seed method",
      );
      await evaluate(
        `(async () => { window.__PI_CAPTURE__ = 1; await window.__PI_DESKTOP__.seedContextInspectorCompaction(${JSON.stringify(options)}); })()`,
      );
      await delay(420);
    };

    // The splash check alone can pass on a document that has not mounted the
    // shell yet, so gate the fixture calls on the app shell and the renderer
    // automation surface that `installRendererApi` installs on mount.
    await waitFor(
      () =>
        evaluate(
          `!!document.querySelector(".main-pane") && typeof window.__PI_DESKTOP__?.ensureVisualFixtures === "function"`,
        ),
      "app shell and renderer automation surface",
    );
    await waitFor(
      () => evaluate(`!document.querySelector(".startup-splash")`),
      "startup splash cleared",
    );
    await evaluate(
      `window.__PI_CAPTURE__ = 1; window.__PI_DESKTOP__.ensureVisualFixtures()`,
    );
    await waitFor(
      () =>
        evaluate(
          `document.querySelector(".app-work-panel-toggle")?.disabled === false`,
        ),
      "session selected by the visual fixtures",
    );

    // 1. Idle: the row offers the action and the newest checkpoint's figures.
    await seed({ mark: "compacted", phase: "idle" });
    await waitFor(
      () => evaluate(`!!document.querySelector(".context-inspector-trigger")`),
      "inspector trigger",
    );
    await evaluate(`document.querySelector(".context-inspector-trigger").click()`);
    await waitFor(
      () => evaluate(`!!document.querySelector(".context-inspector-popover")`),
      "inspector popover",
    );
    const idle = await evaluate(READ_ROW);
    check(
      idle.row && idle.hint && idle.label && idle.disabled === false,
      "the idle card offers an enabled compact action with a hint",
      JSON.stringify(idle),
    );
    check(
      idle.ariaBusy === "false" && idle.spinner === false,
      "the idle action carries no busy state",
      JSON.stringify(idle),
    );
    check(
      idle.compactionRows === 2 && /~92k/.test(idle.before ?? ""),
      "the checkpoint line shows the pre-compaction occupancy",
      JSON.stringify(idle),
    );
    check(
      /context-inspector-popover/.test(
        (await evaluate(`document.activeElement?.className ?? ""`)) ?? "",
      ),
      "opening the card moves focus into the panel",
      await evaluate(`document.activeElement?.className ?? ""`),
    );

    // 2. Clicking spends the existing store action and keeps the card open.
    const expectedSessionId = await evaluate(
      `window.__PI_INSPECTOR_SESSION__ ?? null`,
    );
    await evaluate(
      `document.querySelector(".context-inspector-compact-action").click()`,
    );
    await waitFor(
      () => evaluate(`(window.__PI_COMPACT_CALLS__ ?? []).length > 0`),
      "compact call recorded",
    );
    const calls = JSON.parse(
      await evaluate(`JSON.stringify(window.__PI_COMPACT_CALLS__ ?? [])`),
    );
    const clicked = await evaluate(READ_ROW);
    check(
      !!expectedSessionId &&
        calls.length === 1 &&
        calls[0]?.sessionId === expectedSessionId,
      "clicking the action asks the host to compact the active session",
      JSON.stringify(calls),
    );
    check(
      clicked.popoverOpen,
      "the popover stays open across the action",
      JSON.stringify(clicked),
    );

    // 3. Busy: the runtime's own compacting phase drives label and hint.
    await seed({ mark: "compacted", phase: "compacting" });
    const busy = await evaluate(READ_ROW);
    check(
      busy.disabled === true &&
        busy.ariaBusy === "true" &&
        busy.spinner === true &&
        busy.label !== idle.label &&
        busy.hint !== idle.hint,
      "a compacting session disables the action and swaps label and hint",
      JSON.stringify(busy),
    );

    // 4. Blocked: a live run refuses the action without the busy state.
    await seed({ mark: "compacted", running: true });
    const blocked = await evaluate(READ_ROW);
    check(
      blocked.disabled === true &&
        blocked.spinner === false &&
        blocked.label === idle.label &&
        blocked.hint === idle.hint,
      "a running session disables the action and keeps the idle copy",
      JSON.stringify(blocked),
    );

    // 5. A legacy mark degrades to the single checkpoint line.
    await seed({ mark: "legacy", phase: "idle" });
    const legacy = await evaluate(READ_ROW);
    check(
      legacy.compactionRows === 1 && legacy.before === null,
      "a mark without the figure degrades to the checkpoint line alone",
      JSON.stringify(legacy),
    );

    // 6. No checkpoint at all: the action row still stands alone.
    await seed({ mark: "none", phase: "idle" });
    const none = await evaluate(READ_ROW);
    check(
      none.compactionRows === 0 && none.row === true && none.disabled === false,
      "the action row renders without any checkpoint",
      JSON.stringify(none),
    );

    const failed = results.filter((entry) => !entry.ok);
    for (const entry of failed) console.error(`FAIL ${entry.label} — ${entry.detail}`);
    cleanup();
    clearTimeout(timeout);
    if (failed.length > 0) {
      console.error(`FAIL inspector compact — ${failed.length} of ${results.length} checks failed`);
      process.exit(1);
    }
    console.log(`PASS inspector compact — ${results.length} checks`);
    process.exit(0);
  } catch (error) {
    console.error(`FAIL inspector compact — ${error.message}`);
    try {
      if (activeCdp) {
        console.error("--- renderer console tail ---");
        for (const line of activeCdp.console.slice(-12)) console.error(line);
      }
    } catch {}
    console.error(output.slice(-2_000));
    cleanup();
    clearTimeout(timeout);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
