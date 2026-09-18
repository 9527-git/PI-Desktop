#!/usr/bin/env node
/**
 * E2E-SIDEBAR-status-dot-pending-union.
 *
 * Launches the built desktop app with a throwaway profile and drives the
 * renderer over CDP: seeds one sidebar row per state through the capture rig
 * (selected / running / permission / ask / plan) and asserts the D444 contract —
 *
 *   - the running row breathes in the warning token;
 *   - permission, ask, and Plan/Goal approval rows all render the SAME
 *     needs-input dot (class `permission`, purple pulse), proving the union;
 *   - the selected row keeps its accent ring and no animation;
 *   - the conversation topbar carries no status slot/chip of its own;
 *   - prefers-reduced-motion disables every dot animation;
 *   - both themes resolve the dots to their own warning/purple tokens.
 *
 * Screenshots land in PI_DESKTOP_E2E_ARTIFACT_DIR (or a temp dir) for visual
 * inspection.
 *
 * Prereqs: `pnpm --filter @pi-desktop/desktop build` (or `pnpm build:js`) and a
 * host-core binary (target/debug, target/release, or PI_DESKTOP_HOST_BIN).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const cdpPort = Number(process.env.PI_DESKTOP_SIDEBAR_CDP_PORT || 9339);

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

// Probes every seeded row plus the shared tokens. The dot's painted color and
// animation live on the ::before pseudo-element, so we read that explicitly.
function probeExpression(ids) {
  return `((ids) => {
  const token = (name) => {
    const probe = document.createElement("span");
    probe.style.color = "var(" + name + ")";
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  };
  const rowInfo = (id) => {
    const row = document.querySelector('[data-sidebar-session-row="' + id + '"]');
    const status = row ? row.querySelector(".thread-item-status") : null;
    if (!status) return { present: false };
    const before = getComputedStyle(status, "::before");
    const cs = getComputedStyle(status);
    return {
      present: true,
      stateClass: [...status.classList].find((c) => c !== "thread-item-status") ?? null,
      label: status.getAttribute("aria-label"),
      color: cs.color,
      beforeBackground: before.backgroundColor,
      beforeAnimation: before.animationName,
      beforeBorderTopColor: before.borderTopColor,
      width: Math.round(status.getBoundingClientRect().width),
    };
  };
  const topbar = document.querySelector(".conversation-topbar");
  return {
    rows: {
      selected: rowInfo(ids.selected),
      running: rowInfo(ids.running),
      permission: rowInfo(ids.permission),
      ask: rowInfo(ids.ask),
      plan: rowInfo(ids.plan),
    },
    warningToken: token("--ds-warning"),
    purpleToken: token("--ds-purple"),
    accentToken: token("--ds-accent"),
    topbarHasStatusSlot: !!topbar && !!topbar.querySelector(".ct-status-slot"),
    topbarHasChip: !!topbar && !!topbar.querySelector(".ct-status-chip"),
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
})(${JSON.stringify(ids)})`;
}

const results = [];
let activeCdp = null;
function check(ok, label, detail = "") {
  results.push({ ok, label, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
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
  const dataDir = mkdtempSync(join(tmpdir(), "pi-sidebar-status-data-"));
  const profileDir = mkdtempSync(join(tmpdir(), "pi-sidebar-status-profile-"));
  const artifactDir =
    process.env.PI_DESKTOP_E2E_ARTIFACT_DIR?.trim() ||
    mkdtempSync(join(tmpdir(), "pi-sidebar-status-artifacts-"));
  mkdirSync(artifactDir, { recursive: true });
  console.log(`Artifacts ${artifactDir}`);

  const child = spawn(
    electronBin,
    [
      "--remote-debugging-port=" + cdpPort,
      "--user-data-dir=" + profileDir,
      // An occluded window stops producing frames, which can stall style
      // recalculation during unattended runs.
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
    console.error("FAIL sidebar status dot — timeout after 180s");
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
    await cdp.send("Page.enable");

    // A screenshot forces a BeginFrame so style recalculation does not stall
    // while the window is occluded during unattended runs.
    const forceFrame = async () => {
      await cdp
        .send("Page.captureScreenshot", { format: "png" })
        .catch(() => undefined);
    };
    const probe = (ids) => cdp.evaluate(probeExpression(ids));
    const screenshot = async (name) => {
      const clip = await cdp.evaluate(
        `({ width: Math.min(360, window.innerWidth), height: window.innerHeight })`,
      );
      const response = await cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: clip.width, height: clip.height, scale: 1 },
      });
      const path = join(artifactDir, `${name}.png`);
      writeFileSync(path, Buffer.from(response.data, "base64"));
      console.log(`ARTIFACT ${path}`);
    };

    await waitFor(() => cdp.evaluate(`!!document.querySelector(".main-pane")`), "app shell");
    await waitFor(
      () => cdp.evaluate(`!document.querySelector(".startup-splash")`),
      "startup splash cleared",
    );
    await cdp.evaluate(
      `window.__PI_CAPTURE__ = 1; window.__PI_DESKTOP__.ensureVisualFixtures()`,
    );
    await waitFor(
      () => cdp.evaluate(`!!document.querySelector(".conversation-topbar")`),
      "conversation topbar mounted",
    );

    const ids = await cdp.evaluate(
      `window.__PI_CAPTURE__ = 1; window.__PI_DESKTOP__.seedSidebarInterventions()`,
    );
    if (!ids?.selected) {
      throw new Error("capture rig could not seed 5 distinct sidebar sessions");
    }
    await waitFor(
      async () => {
        const present = await cdp.evaluate(
          `((ids) => [
            document.querySelector('[data-sidebar-session-row="' + ids.selected + '"] .thread-item-status'),
            document.querySelector('[data-sidebar-session-row="' + ids.running + '"] .thread-item-status'),
            document.querySelector('[data-sidebar-session-row="' + ids.permission + '"] .thread-item-status'),
            document.querySelector('[data-sidebar-session-row="' + ids.ask + '"] .thread-item-status'),
            document.querySelector('[data-sidebar-session-row="' + ids.plan + '"] .thread-item-status'),
          ].every(Boolean))(${JSON.stringify(ids)})`,
        );
        return present;
      },
      "all five seeded status dots rendered",
    );
    await forceFrame();
    await delay(200);

    const base = await probe(ids);

    // 1. Running row breathes in the warning token.
    check(
      base.rows.running.present &&
        base.rows.running.stateClass === "running" &&
        base.rows.running.beforeAnimation === "sidebar-status-breathe" &&
        base.rows.running.beforeBackground === base.warningToken,
      "the running row shows an orange breathing dot",
      JSON.stringify(base.rows.running),
    );

    // 2. Permission / ask / plan rows all render the SAME needs-input dot.
    for (const source of ["permission", "ask", "plan"]) {
      const row = base.rows[source];
      check(
        row.present &&
          row.stateClass === "permission" &&
          row.beforeAnimation === "sidebar-status-pulse-purple" &&
          row.beforeBackground === base.purpleToken,
        `a pending ${source} raises the purple needs-input dot`,
        JSON.stringify(row),
      );
    }
    check(
      base.rows.permission.label === base.rows.ask.label &&
        base.rows.ask.label === base.rows.plan.label &&
        typeof base.rows.permission.label === "string" &&
        base.rows.permission.label.length > 0 &&
        base.rows.permission.label !== base.rows.running.label,
      "every intervention source shares one needs-input label, distinct from running",
      JSON.stringify({
        permission: base.rows.permission.label,
        ask: base.rows.ask.label,
        plan: base.rows.plan.label,
        running: base.rows.running.label,
      }),
    );

    // 3. Selected row keeps its accent ring and never animates.
    check(
      base.rows.selected.present &&
        base.rows.selected.stateClass === "selected" &&
        base.rows.selected.beforeAnimation === "none" &&
        base.rows.selected.beforeBorderTopColor === base.accentToken,
      "the selected row shows a static accent ring",
      JSON.stringify(base.rows.selected),
    );

    // 4. The topbar carries no status slot/chip of its own (D444 relocation).
    check(
      base.topbarHasStatusSlot === false && base.topbarHasChip === false,
      "the conversation topbar has no status chip",
      JSON.stringify({
        slot: base.topbarHasStatusSlot,
        chip: base.topbarHasChip,
      }),
    );

    await screenshot("sidebar-status-union-dark");

    // 5. Both themes resolve the dots to their own tokens.
    for (const theme of ["light", "dark"]) {
      await cdp.evaluate(`window.__PI_DESKTOP__.setThemeAttr("${theme}")`);
      await delay(250);
      await forceFrame();
      const themed = await probe(ids);
      check(
        themed.rows.running.beforeBackground === themed.warningToken &&
          themed.rows.permission.beforeBackground === themed.purpleToken,
        `the ${theme} theme paints the running and needs-input dots in their own tokens`,
        JSON.stringify({
          theme,
          running: themed.rows.running.beforeBackground,
          warning: themed.warningToken,
          permission: themed.rows.permission.beforeBackground,
          purple: themed.purpleToken,
        }),
      );
      await screenshot(`sidebar-status-union-${theme}`);
    }
    await cdp.evaluate(`window.__PI_DESKTOP__.setThemeAttr("dark")`);
    await delay(200);

    // 6. Reduced motion disables every dot animation.
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await delay(250);
    await forceFrame();
    const reduced = await probe(ids);
    check(
      reduced.reducedMotion === true &&
        reduced.rows.running.beforeAnimation === "none" &&
        reduced.rows.permission.beforeAnimation === "none",
      "prefers-reduced-motion disables the running and needs-input animations",
      JSON.stringify({
        running: reduced.rows.running.beforeAnimation,
        permission: reduced.rows.permission.beforeAnimation,
      }),
    );
    await screenshot("sidebar-status-union-reduced-motion");
    await cdp.send("Emulation.setEmulatedMedia", { media: "", features: [] });
    await delay(250);
    await forceFrame();
    const restored = await probe(ids);
    check(
      restored.rows.running.beforeAnimation === "sidebar-status-breathe" &&
        restored.rows.permission.beforeAnimation === "sidebar-status-pulse-purple",
      "clearing the emulated preference restores both animations",
      JSON.stringify({
        running: restored.rows.running.beforeAnimation,
        permission: restored.rows.permission.beforeAnimation,
      }),
    );

    const failed = results.filter((entry) => !entry.ok);
    console.log(
      `\nE2E-SIDEBAR-status-dot-pending-union: ${results.length - failed.length}/${results.length} checks passed`,
    );
    if (failed.length) {
      for (const entry of failed) {
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
    console.error(`FAIL sidebar status dot — ${error.message}`);
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
