#!/usr/bin/env node
/**
 * E2E-WINDOW-taskbar-status-badge: the native taskbar/Dock badge follows the
 * aggregate session status (D473).
 *
 * Launches the built desktop app with a throwaway profile and drives the
 * renderer over CDP. The capture rig seeds one aggregate state at a time; Main
 * reports every applied badge on `TASKBAR_STATUS_PROBE` lines, which this
 * script asserts:
 *
 *   - running work paints the warning badge with a live count;
 *   - a pending permission outranks running and paints the needs-input badge;
 *   - unread failed / completed outcomes paint their own badges;
 *   - clearing every source removes the badge;
 *   - a malformed snapshot is rejected with INVALID_ARGUMENT, so a bad caller
 *     can never clear or invent a badge.
 *
 * Prereqs: `pnpm --filter @pi-desktop/desktop build` and a host-core binary
 * (target/debug, target/release, or PI_DESKTOP_HOST_BIN).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const appDir = join(root, "apps", "desktop");
const electronBin =
  process.platform === "win32"
    ? join(appDir, "node_modules/electron/dist/electron.exe")
    : join(appDir, "node_modules/.bin/electron");
const cdpPort = Number(process.env.PI_DESKTOP_TASKBAR_CDP_PORT || 9341);

function resolveHostBinary() {
  const candidates = [
    process.env.PI_DESKTOP_HOST_BIN?.trim(),
    join(root, "target", "debug", "pi-desktop-host-core"),
    join(root, "target", "debug", "pi-desktop-host-core.exe"),
    join(root, "target", "release", "pi-desktop-host-core"),
    join(root, "target", "release", "pi-desktop-host-core.exe"),
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `host-core binary not found; run cargo build -p host-core or set PI_DESKTOP_HOST_BIN\nchecked: ${candidates.join(", ")}`,
    );
  }
  return found;
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
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

const results = [];
function check(ok, label, detail = "") {
  results.push({ ok, label, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
}

async function main() {
  if (!existsSync(join(appDir, "out/main/index.js"))) {
    console.error("desktop app not built. Run: pnpm --filter @pi-desktop/desktop build");
    process.exit(1);
  }
  if (!existsSync(electronBin)) {
    console.error("Electron binary missing:", electronBin);
    process.exit(1);
  }

  const hostBinary = resolveHostBinary();
  const dataDir = mkdtempSync(join(tmpdir(), "pi-taskbar-status-data-"));
  const profileDir = mkdtempSync(join(tmpdir(), "pi-taskbar-status-profile-"));

  const child = spawn(
    electronBin,
    [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      "--disable-backgrounding-occluded-windows",
      ".",
    ],
    {
      cwd: appDir,
      env: {
        ...process.env,
        PI_DESKTOP_DATA_DIR: dataDir,
        PI_DESKTOP_HOST_BIN: hostBinary,
        PI_DESKTOP_START_MAXIMIZED: "0",
        PI_DESKTOP_TASKBAR_PROBE: "1",
        ELECTRON_RENDERER_URL: "",
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  const probes = [];
  let pendingLine = "";
  const collect = (chunk) => {
    output += String(chunk);
    const lines = `${pendingLine}${String(chunk)}`.split(/\r?\n/);
    pendingLine = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("TASKBAR_STATUS_PROBE ")) continue;
      try {
        probes.push(JSON.parse(line.slice("TASKBAR_STATUS_PROBE ".length)));
      } catch {
        // A torn line is not a probe result.
      }
    }
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
    console.error("FAIL taskbar status badge — timeout after 180s");
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
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");

    await waitFor(() => cdp.evaluate(`!!document.querySelector(".main-pane")`), "app shell");
    await waitFor(
      () => cdp.evaluate(`!document.querySelector(".startup-splash")`),
      "startup splash cleared",
    );
    await cdp.evaluate(
      `window.__PI_CAPTURE__ = 1; window.__PI_DESKTOP__.ensureVisualFixtures()`,
    );

    const nextProbe = async (kind, count, timeoutMs = 20_000) =>
      waitFor(
        () =>
          probes.find(
            (probe) =>
              probe.kind === kind &&
              probe.count === count &&
              probe.applied === true,
          ),
        `${kind}:${count} badge probe`,
        timeoutMs,
      );

    const seed = async (kind) => {
      await cdp.evaluate(
        `window.__PI_CAPTURE__ = 1; window.__PI_DESKTOP__.seedTaskbarStatus(${JSON.stringify(kind)})`,
      );
    };

    // 1. Running work paints the warning badge with a live count.
    await seed("running");
    const running = await nextProbe("running", 1);
    check(
      running.platform === process.platform && running.applied === true,
      "a running session paints the running badge",
      JSON.stringify(running),
    );

    // 2. Needs-input outranks running: the same session is both.
    await seed("attention");
    const attention = await nextProbe("attention", 1);
    check(
      attention.applied === true,
      "a pending permission outranks running and paints the needs-input badge",
      JSON.stringify(attention),
    );

    // 3. Unread terminal outcomes paint their own badges.
    await seed("failed");
    const failed = await nextProbe("failed", 1);
    check(failed.applied === true, "an unread failed outcome paints the failed badge");
    await seed("completed");
    const completed = await nextProbe("completed", 1);
    check(
      completed.applied === true,
      "an unread completed outcome paints the completed badge",
    );

    // 4. Clearing every source removes the badge.
    await seed("none");
    const none = await nextProbe("none", 0);
    check(none.applied === true, "clearing every source removes the native badge");

    // 5. A malformed snapshot is rejected instead of painting anything.
    const rejected = await cdp.evaluate(`(async () => {
      const api = window.piDesktop;
      const result = await api.invoke(api.channels.invoke.windowSetTaskbarStatus, {
        snapshot: { kind: "bogus", count: 1 },
      });
      return { ok: result.ok, code: result.ok ? null : result.error.code };
    })()`);
    check(
      rejected.ok === false && rejected.code === "INVALID_ARGUMENT",
      "a malformed snapshot is rejected with INVALID_ARGUMENT",
      JSON.stringify(rejected),
    );
    const before = probes.length;
    await delay(300);
    check(
      probes.length === before,
      "the rejected snapshot never reaches the native badge",
      JSON.stringify({ before, after: probes.length }),
    );

    const failedChecks = results.filter((entry) => !entry.ok);
    console.log(
      `\nE2E-WINDOW-taskbar-status-badge: ${results.length - failedChecks.length}/${results.length} checks passed`,
    );
    if (failedChecks.length) {
      for (const entry of failedChecks) {
        console.error(`FAILED ${entry.label} — ${entry.detail}`);
      }
      cleanup();
      clearTimeout(timeout);
      process.exit(1);
    }
    cleanup();
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) {
    console.error(`FAIL taskbar status badge — ${error.message}`);
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
