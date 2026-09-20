#!/usr/bin/env node
/**
 * E2E-SIDEBAR-status-dot-pending-union.
 *
 * Launches the built desktop app with a throwaway profile and drives the
 * renderer over CDP: seeds one sidebar row per state through the capture rig
 * (selected / running / permission / ask / plan) and asserts the D444 contract —
 *
 *   - the running pill is a solid warning capsule whose dot breathes;
 *   - permission, ask, and Plan/Goal approval rows all render the SAME solid
 *     needs-input pill (class `permission`, purple), proving the union;
 *   - the selected row keeps a quiet outlined accent pill and no animation;
 *   - the conversation topbar carries no status slot/chip of its own;
 *   - prefers-reduced-motion disables every dot animation;
 *   - both themes resolve the pills to their own warning/purple tokens.
 *
 * and the D455 contract on top of it — every pill names its state in the row
 * with a short locale word (never clipped), the pill leads its own row's left
 * edge, the title it labels follows the pill's own clearance, and a quiet row's
 * title starts on that same left edge. The full phrase lives on the pill's
 * tooltip and accessible name.
 *
 * The list furniture's inset (time separator, load-more row, empty copy) is a
 * static CSS contract and belongs to the source test,
 * `apps/desktop/test/sidebar-session-status.test.mjs`; this scenario's
 * throwaway profile seeds no project group and no non-today session, so it
 * cannot render that furniture to measure.
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

// Probes every seeded row plus the shared tokens. The pill's fill, its word and
// its dot's motion are what the eye reads, so all three are measured directly,
// along with the lane geometry the row reserves around them.
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
  const cssPx = (name) => {
    const probe = document.createElement("span");
    // An inline box ignores a set width, which silently resolved every lane
    // token to 0; the probe has to be a block for the variable to become pixels.
    probe.style.display = "block";
    probe.style.width = "var(" + name + ")";
    document.body.appendChild(probe);
    const value = probe.getBoundingClientRect().width;
    probe.remove();
    return Math.round(value);
  };
  const rowInfo = (id) => {
    const row = document.querySelector('[data-sidebar-session-row="' + id + '"]');
    const status = row ? row.querySelector(".thread-item-status") : null;
    if (!status) return { present: false };
    const cs = getComputedStyle(status);
    const word = status.querySelector(".thread-item-status-word");
    const dot = status.querySelector(".thread-item-status-dot");
    const title = row.querySelector(".thread-item-title");
    const rowBox = row.getBoundingClientRect();
    const statusBox = status.getBoundingClientRect();
    const titleBox = title ? title.getBoundingClientRect() : null;
    return {
      present: true,
      stateClass: [...status.classList].find((c) => c !== "thread-item-status") ?? null,
      label: status.getAttribute("aria-label"),
      tooltip: status.getAttribute("title"),
      word: word ? word.textContent : null,
      wordClipped: word ? word.scrollWidth > word.clientWidth : null,
      pillBackground: cs.backgroundColor,
      pillInk: cs.color,
      pillBorder: cs.borderTopColor,
      pillHeight: Math.round(statusBox.height),
      dotAnimation: dot ? getComputedStyle(dot).animationName : null,
      markerPosition: cs.position,
      // D446: the status group must stay centred on the whole row, not drift onto
      // one of its lines.
      statusCenterOffset: Math.round(
        statusBox.top + statusBox.height / 2 - (rowBox.top + rowBox.height / 2),
      ),
      previewShown: !!row.querySelector(".thread-item-preview"),
      titleShown: !!title,
      // D451: the lane belongs to the row button, so the pill is part of the
      // click target and never shares the title's line.
      insideRowButton: !!status.closest("button.thread-item-main"),
      markerLeft: Math.round(statusBox.left - rowBox.left),
      pillRight: Math.round(statusBox.right - rowBox.left),
      pillWidth: Math.round(statusBox.width),
      rowHeight: Math.round(rowBox.height),
      fontScale: getComputedStyle(document.documentElement)
        .getPropertyValue("--font-scale")
        .trim(),
      titleLeft: titleBox ? Math.round(titleBox.left - rowBox.left) : null,
    };
  };
  const topbar = document.querySelector(".conversation-topbar");
  // D455: a row without a status is the control for the row's own text column.
  // A pin or the native-Pi marker takes 4px on each side of itself, so a plain
  // row is the one that has to land exactly on the inset.
  const quietRow = [...document.querySelectorAll(".thread-item")].find(
    (row) =>
      !row.querySelector(".thread-item-status") &&
      !row.querySelector(".thread-item-pin") &&
      !row.querySelector(".thread-item-source") &&
      row.querySelector(".thread-item-title"),
  );
  const quietRowTitleLeft = quietRow
    ? Math.round(
        quietRow.querySelector(".thread-item-title").getBoundingClientRect().left -
          quietRow.getBoundingClientRect().left,
      )
    : null;
  return {
    rows: {
      selected: rowInfo(ids.selected),
      running: rowInfo(ids.running),
      permission: rowInfo(ids.permission),
      ask: rowInfo(ids.ask),
      plan: rowInfo(ids.plan),
    },
    laneWidth: cssPx("--ds-sidebar-status-lane"),
    pillGap: cssPx("--ds-sidebar-status-pill-gap"),
    warningToken: token("--ds-warning"),
    purpleToken: token("--ds-purple"),
    accentToken: token("--ds-accent"),
    inkToken: token("--ds-status-ink"),
    quietRowTitleLeft,
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

    // 1. D451: the running pill is a solid warning capsule that names its state,
    //    and its dot carries the breathe motion.
    check(
      base.rows.running.present &&
        base.rows.running.stateClass === "running" &&
        base.rows.running.dotAnimation === "sidebar-status-breathe" &&
        base.rows.running.pillBackground === base.warningToken &&
        base.rows.running.pillInk === base.inkToken,
      "the running row shows a solid warning pill whose dot breathes",
      JSON.stringify(base.rows.running),
    );

    // 2. Permission / ask / plan rows all render the SAME solid needs-input pill.
    for (const source of ["permission", "ask", "plan"]) {
      const row = base.rows[source];
      check(
        row.present &&
          row.stateClass === "permission" &&
          row.dotAnimation === "sidebar-status-pulse-purple" &&
          row.pillBackground === base.purpleToken &&
          row.pillInk === base.inkToken,
        `a pending ${source} raises the solid purple needs-input pill`,
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

    // 3. The selected row keeps a quiet outlined accent pill and never animates.
    //    D451 gives the quiet states no dot at all, so "no animation" is either a
    //    missing dot (null) or a dot whose animation resolved to `none`.
    check(
      base.rows.selected.present &&
        base.rows.selected.stateClass === "selected" &&
        (base.rows.selected.dotAnimation === null ||
          base.rows.selected.dotAnimation === "none") &&
        base.rows.selected.pillBorder === base.accentToken &&
        base.rows.selected.pillInk === base.accentToken,
      "the selected row shows a static outlined accent pill",
      JSON.stringify(base.rows.selected),
    );

    // 4. D451: every state is named in the row. Each pill carries its short
    //    locale word unclipped beside its dot or glyph, the row still shows its
    //    title alone, and the full phrase stays on the pill's tooltip and
    //    accessible name.
    const pillIsLabelled = (row) =>
      row.titleShown === true &&
      row.previewShown === false &&
      typeof row.word === "string" &&
      row.word.length > 0 &&
      row.wordClipped === false &&
      typeof row.label === "string" &&
      row.label.length > 0 &&
      row.label === row.tooltip;
    check(
      pillIsLabelled(base.rows.running),
      "the running row's pill carries its short word unclipped",
      JSON.stringify(base.rows.running),
    );
    for (const source of ["permission", "ask", "plan"]) {
      check(
        pillIsLabelled(base.rows[source]),
        `a pending ${source}'s pill carries the shared needs-input word unclipped`,
        JSON.stringify(base.rows[source]),
      );
    }
    check(
      pillIsLabelled(base.rows.selected),
      "the selected row's pill carries its short word unclipped",
      JSON.stringify(base.rows.selected),
    );

    // 4b. D455: the row reserves no lane. The pill leads the row's own left
    //     edge, the title it labels starts on the pill's own clearance, and a
    //     quiet row's title starts on that same left edge - so the marker never
    //     shares the title's line and never takes it off the row.
    const attentionRows = ["running", "permission", "ask", "plan"].map(
      (key) => base.rows[key],
    );
    const everyRow = [base.rows.selected, ...attentionRows];
    const skipNote = (missing) => (missing ? " — SKIPPED: not seeded" : "");
    const rowInset = 4;
    const laneCap = base.laneWidth - base.pillGap;
    check(
      base.pillGap > 0 &&
        everyRow.every(
          (row) =>
            row.markerPosition === "static" &&
            Math.abs(row.markerLeft - rowInset) <= 1 &&
            row.pillWidth > 0 &&
            // The pill leads the row's 4px inset, so its own width - not its
            // right edge - is what the lane token still caps.
            row.pillWidth <= laneCap &&
            row.insideRowButton,
        ),
      "every pill leads its own row's left edge, inside the row button",
      JSON.stringify({
        pillGap: base.pillGap,
        laneCap,
        rows: everyRow.map((row) => [
          row.markerPosition,
          row.markerLeft,
          row.pillWidth,
          row.insideRowButton,
        ]),
      }),
    );
    check(
      everyRow.every(
        (row) =>
          row.titleLeft !== null &&
          row.titleLeft >= row.pillRight + base.pillGap &&
          // A pinned row or a native-Pi row puts its marker between the pill and
          // the title, which costs the marker's own 4px + its 11px glyph.
          row.titleLeft <= row.pillRight + base.pillGap + 20,
      ),
      "every marked row's title follows its own pill, marker or not",
      JSON.stringify(
        everyRow.map((row) => [row.titleLeft, row.pillRight + base.pillGap]),
      ),
    );
    check(
      base.quietRowTitleLeft === null ||
        Math.abs(base.quietRowTitleLeft - rowInset) <= 1,
      "a quiet row's title starts on the row's own left edge",
      JSON.stringify({ quietRowTitleLeft: base.quietRowTitleLeft }) +
        skipNote(base.quietRowTitleLeft === null),
    );
    check(
      everyRow.every(
        (row) =>
          row.pillHeight === 20 &&
          row.rowHeight === 28 &&
          Math.abs(row.statusCenterOffset) <= 2,
      ),
      "every pill keeps the row's vertical centre without changing the row pitch",
      JSON.stringify(
        everyRow.map((row) => [
          row.pillHeight,
          row.statusCenterOffset,
          row.rowHeight,
        ]),
      ),
    );

    // 4c. The row's own text column is the control: a marked row and a quiet
    //     row now start their titles on DIFFERENT x positions (the pill's own
    //     clearance apart), which is the trade D455 accepted. The list's
    //     furniture inset is a static CSS contract and is asserted in
    //     sidebar-session-status.test.mjs, since this profile seeds neither a
    //     project group nor a non-today session to render.

    // 5. The topbar carries no status slot/chip of its own (D444 relocation).
    check(
      base.topbarHasStatusSlot === false && base.topbarHasChip === false,
      "the conversation topbar has no status chip",
      JSON.stringify({
        slot: base.topbarHasStatusSlot,
        chip: base.topbarHasChip,
      }),
    );

    await screenshot("sidebar-status-union-dark");

    // 6. Both themes paint the pills with their own tokens.
    for (const theme of ["light", "dark"]) {
      await cdp.evaluate(`window.__PI_DESKTOP__.setThemeAttr("${theme}")`);
      await delay(250);
      await forceFrame();
      const themed = await probe(ids);
      check(
        themed.rows.running.pillBackground === themed.warningToken &&
          themed.rows.permission.pillBackground === themed.purpleToken,
        `the ${theme} theme paints the running and needs-input pills in their own tokens`,
        JSON.stringify({
          theme,
          running: themed.rows.running.pillBackground,
          warning: themed.warningToken,
          permission: themed.rows.permission.pillBackground,
          purple: themed.purpleToken,
        }),
      );
      await screenshot(`sidebar-status-union-${theme}`);
    }
    await cdp.evaluate(`window.__PI_DESKTOP__.setThemeAttr("dark")`);
    await delay(200);

    // 7. Reduced motion disables every dot animation.
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await delay(250);
    await forceFrame();
    const reduced = await probe(ids);
    check(
      reduced.reducedMotion === true &&
        reduced.rows.running.dotAnimation === "none" &&
        reduced.rows.permission.dotAnimation === "none",
      "prefers-reduced-motion disables the running and needs-input animations",
      JSON.stringify({
        running: reduced.rows.running.dotAnimation,
        permission: reduced.rows.permission.dotAnimation,
      }),
    );
    await screenshot("sidebar-status-union-reduced-motion");
    await cdp.send("Emulation.setEmulatedMedia", { media: "", features: [] });
    await delay(250);
    await forceFrame();
    const restored = await probe(ids);
    check(
      restored.rows.running.dotAnimation === "sidebar-status-breathe" &&
        restored.rows.permission.dotAnimation === "sidebar-status-pulse-purple",
      "clearing the emulated preference restores both animations",
      JSON.stringify({
        running: restored.rows.running.dotAnimation,
        permission: restored.rows.permission.dotAnimation,
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
