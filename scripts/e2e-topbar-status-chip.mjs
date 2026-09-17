#!/usr/bin/env node
/**
 * E2E-CHAT-topbar-status-chip.
 *
 * Launches the built desktop app with a throwaway profile and drives the
 * renderer over CDP: seeds run / intervention state through the capture rig and
 * asserts the conversation topbar's status chip contract —
 *
 *   - hidden while the session is idle, and only the title occupies the lane;
 *   - `处理中` while the turn runs (orange dot, breathing);
 *   - `待确认` whenever any intervention source is pending (permission, ask,
 *     Plan/Goal approval), outranking the running state;
 *   - the chip sits left of the title, takes width from the title lane, and is
 *     not a control;
 *   - prefers-reduced-motion turns the dot animation and the slot transition
 *     off; both themes resolve the dot to their own warning/purple token.
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
const cdpPort = Number(process.env.PI_DESKTOP_TOPBAR_CDP_PORT || 9338);

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

const PROBE = `(() => {
  const topbar = document.querySelector(".conversation-topbar");
  const wrap = topbar?.querySelector(".ct-title-wrap") ?? null;
  const slot = wrap?.querySelector(".ct-status-slot") ?? null;
  const chip = slot?.querySelector(".ct-status-chip") ?? null;
  const dot = chip?.querySelector(".ct-status-dot") ?? null;
  const title = wrap?.querySelector(".ct-title") ?? null;
  const token = (name) => {
    const probe = document.createElement("span");
    probe.style.color = "var(" + name + ")";
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  };
  const box = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };
  const slotStyle = slot ? getComputedStyle(slot) : null;
  const dotStyle = dot ? getComputedStyle(dot) : null;
  return {
    hasTopbar: !!topbar,
    state: slot ? slot.dataset.state ?? null : null,
    label: chip ? chip.textContent.trim() : null,
    dotBackground: dotStyle ? dotStyle.backgroundColor : null,
    dotAnimation: dotStyle ? dotStyle.animationName : null,
    chipColor: chip ? getComputedStyle(chip).color : null,
    chipBackground: chip ? getComputedStyle(chip).backgroundColor : null,
    warningToken: token("--ds-warning"),
    purpleToken: token("--ds-purple"),
    slotBox: box(slot),
    titleBox: box(title),
    maxWidth: slotStyle ? slotStyle.maxWidth : null,
    opacity: slotStyle ? slotStyle.opacity : null,
    transitionProperty: slotStyle ? slotStyle.transitionProperty : null,
    transitionDuration: slotStyle ? slotStyle.transitionDuration : null,
    interactive: slot
      ? Boolean(slot.querySelector("button, a, [role=button], input, [tabindex]"))
      : false,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
})()`;

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
  const dataDir = mkdtempSync(join(tmpdir(), "pi-topbar-status-data-"));
  const profileDir = mkdtempSync(join(tmpdir(), "pi-topbar-status-profile-"));
  const artifactDir =
    process.env.PI_DESKTOP_E2E_ARTIFACT_DIR?.trim() ||
    mkdtempSync(join(tmpdir(), "pi-topbar-status-artifacts-"));
  mkdirSync(artifactDir, { recursive: true });
  console.log(`Artifacts ${artifactDir}`);

  const child = spawn(
    electronBin,
    [
      "--remote-debugging-port=" + cdpPort,
      "--user-data-dir=" + profileDir,
      // An occluded window stops producing frames, which freezes the slot's
      // CSS transition mid-flight during unattended runs.
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
    console.error("FAIL topbar status chip — timeout after 180s");
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

    const probe = () => cdp.evaluate(PROBE);
    // Occluded windows can stall frame production, freezing the slot's
    // CSS transition mid-flight; a screenshot forces a BeginFrame.
    const forceFrame = async () => {
      await cdp
        .send("Page.captureScreenshot", { format: "png" })
        .catch(() => undefined);
    };
    const settle = async (target) => {
      const settled =
        target === "hidden"
          ? (value) => value.maxWidth === "0px" && value.opacity === "0"
          : (value) => value.maxWidth === "200px" && value.opacity === "1";
      await delay(240);
      let last = await probe();
      const deadline = Date.now() + 5_000;
      while (!settled(last) && Date.now() < deadline) {
        await forceFrame();
        await delay(80);
        last = await probe();
      }
      return last;
    };
    const seed = async (state) => {
      await cdp.evaluate(
        `window.__PI_CAPTURE__ = 1; window.__PI_DESKTOP__.seedTopbarStatus(${JSON.stringify(state)})`,
      );
      return settle(Object.keys(state).length ? "visible" : "hidden");
    };
    const screenshot = async (name) => {
      const clip = await cdp.evaluate(
        `({ width: window.innerWidth, height: 46 })`,
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
    const seeded = await cdp.evaluate(
      `window.__PI_DESKTOP__.seedTopbarStatus({})`,
    );
    if (!seeded?.sessionId) throw new Error("no session available to seed the chip");

    // 1. Idle: no chip, and the title owns the whole lane.
    const idle = await settle("hidden");
    check(
      idle.hasTopbar && idle.state === "hidden" && idle.label === null,
      "an idle session shows no status chip",
      JSON.stringify(idle),
    );
    check(
      idle.opacity === "0" && idle.maxWidth === "0px" && idle.interactive === false,
      "the collapsed slot takes no space and exposes no control",
      JSON.stringify(idle),
    );
    const idleTitleLeft = idle.titleBox?.left ?? null;

    // 2. Running: orange breathing chip, title slides right.
    const running = await seed({ running: true });
    check(
      running.state === "running" &&
        typeof running.label === "string" &&
        running.label.length > 0,
      "the running state renders a labelled chip",
      JSON.stringify(running),
    );
    check(
      running.dotAnimation === "ct-status-breathe" &&
        running.dotBackground === running.warningToken,
      "the running dot breathes in the warning token color",
      JSON.stringify(running),
    );
    check(
      running.chipBackground !== "rgba(0, 0, 0, 0)" &&
        running.interactive === false,
      "the chip paints a tinted pill and stays a non-control",
      JSON.stringify(running),
    );
    check(
      running.titleBox !== null &&
        running.slotBox !== null &&
        running.slotBox.right <= running.titleBox.left + 1 &&
        idleTitleLeft !== null &&
        running.titleBox.left > idleTitleLeft,
      "the chip sits left of the title and takes its width from the title lane",
      JSON.stringify({ idle: idle.titleBox, running: running.titleBox }),
    );
    check(
      String(running.transitionProperty).includes("max-width") &&
        String(running.transitionDuration)
          .split(",")
          .every((value) => value.trim() === "0.2s"),
      "the slot animates max-width so the title slides instead of jumping",
      JSON.stringify(running),
    );
    await screenshot("topbar-status-running-dark");

    // 3. Pending outranks running for every intervention source.
    const pendingPermission = await seed({ running: true, permission: true });
    check(
      pendingPermission.state === "pending" &&
        pendingPermission.dotAnimation === "ct-status-pulse" &&
        pendingPermission.dotBackground === pendingPermission.purpleToken,
      "a pending permission outranks the running state with a pulsing purple dot",
      JSON.stringify(pendingPermission),
    );
    check(
      pendingPermission.label !== running.label,
      "the pending state carries its own label",
      `${running.label} -> ${pendingPermission.label}`,
    );
    await screenshot("topbar-status-pending-dark");

    const singleSource = {};
    for (const source of ["ask", "plan"]) {
      singleSource[source] = (await seed({ running: true, [source]: true })).state;
    }
    check(
      singleSource.ask === "pending" && singleSource.plan === "pending",
      "an asktool question or a pending Plan/Goal approval alone raises the chip",
      JSON.stringify(singleSource),
    );

    // 4. Both themes resolve the dot to their own token.
    await seed({ running: true });
    for (const theme of ["dark", "light"]) {
      await cdp.evaluate(`window.__PI_DESKTOP__.setThemeAttr("${theme}")`);
      await delay(250);
      const themed = await probe();
      check(
        themed.dotBackground === themed.warningToken &&
          themed.chipBackground !== "rgba(0, 0, 0, 0)",
        `the ${theme} theme paints the running dot in its own warning token`,
        JSON.stringify({
          theme,
          dot: themed.dotBackground,
          token: themed.warningToken,
        }),
      );
      await screenshot(`topbar-status-running-${theme}`);
    }
    await cdp.evaluate(`window.__PI_DESKTOP__.setThemeAttr("dark")`);
    await delay(200);

    // 5. Reduced motion switches the animation and the transition off.
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await delay(250);
    const reduced = await probe();
    check(
      reduced.reducedMotion === true &&
        reduced.dotAnimation === "none" &&
        String(reduced.transitionDuration)
          .split(",")
          .every((value) => value.trim() === "0s"),
      "prefers-reduced-motion disables the dot animation and the slot transition",
      JSON.stringify(reduced),
    );
    await cdp.send("Emulation.setEmulatedMedia", { media: "", features: [] });
    await delay(250);
    const restored = await probe();
    check(
      restored.dotAnimation === "ct-status-breathe",
      "clearing the emulated preference restores the animation",
      JSON.stringify(restored),
    );

    // 6. Clearing every source hides the chip again.
    const cleared = await seed({});
    check(
      cleared.state === "hidden" && cleared.label === null,
      "clearing the last intervention source removes the chip",
      JSON.stringify(cleared),
    );

    const failed = results.filter((entry) => !entry.ok);
    console.log(
      `\nE2E-CHAT-topbar-status-chip: ${results.length - failed.length}/${results.length} checks passed`,
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
    console.error(`FAIL topbar status chip — ${error.message}`);
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
