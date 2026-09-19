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
 * and the D451 contract on top of it — every pill names its state in the row
 * with a short locale word (never clipped), every row reserves the same fixed
 * status lane on its own left edge so the pill column and the title column are
 * stable whether or not a row carries a status, and the list's furniture keeps
 * one text column: a project header's name starts on the session titles'
 * column and a time separator rides the lane. The full phrase lives on the
 * pill's tooltip and accessible name.
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
      titleLeft: titleBox ? Math.round(titleBox.left - rowBox.left) : null,
    };
  };
  // D451: the list keeps one text column. A project header's name starts on the
  // session titles' column with its glyph cluster inside the lane, and a time
  // separator rides the lane with its own head start.
  const groupEl = document.querySelector(".sidebar-session-group.project-group");
  const groupLeft = groupEl ? groupEl.getBoundingClientRect().left : null;
  const rel = (el) =>
    el && groupLeft !== null
      ? Math.round(el.getBoundingClientRect().left - groupLeft)
      : null;
  const groupRow = groupEl ? groupEl.querySelector(".thread-item") : null;
  const headerName = groupEl
    ? groupEl.querySelector(".sidebar-session-group-title.project-toggle > span")
    : null;
  const headerNameLeft = rel(headerName);
  const groupTitleLeft = rel(groupRow ? groupRow.querySelector(".thread-item-title") : null);
  const headerGlyphLeft = rel(groupEl ? groupEl.querySelector(".sidebar-disclosure-icon") : null);
  const timeHeader = document.querySelector(".sidebar-time-group-header");
  const topbar = document.querySelector(".conversation-topbar");
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
    headerNameLeft,
    groupTitleLeft,
    headerGlyphLeft,
    timeHeaderLeft: timeHeader
      ? Math.round(parseFloat(getComputedStyle(timeHeader).paddingLeft))
      : null,
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

    // 4b. D451: every row reserves the same fixed lane on its own left edge, so
    //     the title column is stable whether or not a row carries a status. The
    //     pill hugs its own word inside that lane and must never cross the gap
    //     into the title column.
    const attentionRows = ["running", "permission", "ask", "plan"].map(
      (key) => base.rows[key],
    );
    const everyRow = [base.rows.selected, ...attentionRows];
    const laneCap = base.laneWidth - base.pillGap;
    check(
      base.laneWidth > 0 &&
        base.pillGap > 0 &&
        everyRow.every(
          (row) =>
            row.markerPosition === "absolute" &&
            row.markerLeft === 0 &&
            row.pillRight > 0 &&
            row.pillRight <= laneCap &&
            row.insideRowButton,
        ),
      "every pill hugs its word inside its own row's lane without crossing into the title column",
      JSON.stringify({
        laneWidth: base.laneWidth,
        pillGap: base.pillGap,
        rows: everyRow.map((row) => [
          row.markerPosition,
          row.markerLeft,
          row.pillRight,
          row.insideRowButton,
        ]),
      }),
    );
    check(
      everyRow.every((row) => row.titleLeft === base.laneWidth),
      "every row's title starts on the lane's end, status or not",
      JSON.stringify(everyRow.map((row) => row.titleLeft)),
    );
    check(
      everyRow.every(
        (row) => row.pillHeight === 20 && Math.abs(row.statusCenterOffset) <= 2,
      ),
      "every pill keeps the row's vertical centre without changing the row pitch",
      JSON.stringify(everyRow.map((row) => [row.pillHeight, row.statusCenterOffset])),
    );

    // 4c. D451: the list keeps one text column. A project header's name starts on
    //     the session titles' column with its glyph cluster inside the lane, and
    //     a time separator rides the lane with its own head start. A null
    //     measurement means the fixture seeded no such furniture, so the detail
    //     says SKIPPED instead of letting an unmeasured check read as a real one.
    const skipNote = (missing) => (missing ? " — SKIPPED: furniture not seeded" : "");
    const noGroup = base.groupTitleLeft === null;
    check(
      base.headerNameLeft === null ||
        noGroup ||
        Math.abs(base.headerNameLeft - base.groupTitleLeft) <= 1,
      "a project header's name starts on the session titles' column",
      JSON.stringify({
        headerNameLeft: base.headerNameLeft,
        groupTitleLeft: base.groupTitleLeft,
      }) + skipNote(base.headerNameLeft === null || noGroup),
    );
    check(
      base.headerGlyphLeft === null ||
        noGroup ||
        (base.headerGlyphLeft >= 0 && base.headerGlyphLeft < base.groupTitleLeft),
      "a project header's glyph cluster stays inside the status lane",
      JSON.stringify({
        headerGlyphLeft: base.headerGlyphLeft,
        groupTitleLeft: base.groupTitleLeft,
      }) + skipNote(base.headerGlyphLeft === null || noGroup),
    );
    check(
      base.timeHeaderLeft === null ||
        Math.abs(base.timeHeaderLeft - (base.laneWidth + 20)) <= 1,
      "a time separator rides the lane with its own head start",
      JSON.stringify({ timeHeaderLeft: base.timeHeaderLeft, laneWidth: base.laneWidth }) +
        skipNote(base.timeHeaderLeft === null),
    );

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
