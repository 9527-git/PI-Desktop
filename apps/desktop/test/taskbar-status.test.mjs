import assert from "node:assert/strict";
import * as fs from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(relative, imports, globals = {}) {
  const file = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: file.pathname,
  });
  const module = { exports: {} };
  new Function("require", "exports", "module", ...Object.keys(globals), outputText)(
    (id) => {
      assert.ok(Object.hasOwn(imports, id), `unexpected dependency: ${id}`);
      return imports[id];
    },
    module.exports,
    module,
    ...Object.values(globals),
  );
  return module.exports;
}

function fakeNativeImage() {
  return {
    isEmpty: () => false,
    addRepresentation: () => undefined,
  };
}

function loadController(platform, overrides = {}) {
  const dockBadges = [];
  const electron = {
    app: {
      dock: {
        setBadge: (value) => dockBadges.push(value),
      },
    },
    nativeImage: {
      createFromBitmap: () => fakeNativeImage(),
    },
  };
  const i18n = {
    catalogs: {
      en: {
        taskbar: {
          running: "PI-Desktop is working",
          attention: "PI-Desktop needs your input",
          failed: "PI-Desktop has a failed task",
          completed: "PI-Desktop has a finished task",
        },
      },
    },
    resolveLocale: () => "en",
  };
  const module = load(
    "../electron/main/taskbar-status.ts",
    { electron, "@pi-desktop/i18n": i18n },
    {},
  );
  const calls = [];
  const window = {
    isDestroyed: () => false,
    setOverlayIcon: (image, description) => calls.push({ image, description }),
  };
  const controller = module.createTaskbarStatusController({
    getWindow: () => (overrides.noWindow ? null : window),
    getLocale: () => "en",
    platform,
  });
  return { module, controller, calls, dockBadges };
}

/** The Windows badge artwork contract (D473, repainted by D474). */
const BADGE_STATES = {
  running: { color: "#ff8549", glyph: "dots" },
  attention: { color: "#c27aff", glyph: "exclaim" },
  failed: { color: "#ff6764", glyph: "cross" },
  completed: { color: "#40c977", glyph: "check" },
};

/** Mirrors `--ds-status-ink` (`--gray-900`). */
const INK = [0x18, 0x18, 0x18];

function pixel(buffer, size, x, y) {
  const offset = (y * size + x) * 4;
  return {
    blue: buffer[offset],
    green: buffer[offset + 1],
    red: buffer[offset + 2],
    alpha: buffer[offset + 3],
  };
}

function isInk({ red, green, blue, alpha }) {
  return alpha === 255 && red === INK[0] && green === INK[1] && blue === INK[2];
}

function hexRgb(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** WCAG relative luminance/contrast; the arithmetic behind the token pairs. */
function relativeLuminance([red, green, blue]) {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/**
 * A pixel reads as the mark when more than half of it is ink. The glyph edges
 * are anti-aliased, so an exact-colour match would only ever see whole pixels.
 */
function isMajorityInk(sample, fillHex) {
  if (sample.alpha !== 255) return false;
  const here = relativeLuminance([sample.red, sample.green, sample.blue]);
  const ink = relativeLuminance(INK);
  const fill = relativeLuminance(hexRgb(fillHex));
  return Math.abs(here - ink) < Math.abs(here - fill);
}

function contrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("the badge is a full-bleed state disc with an ink rim", () => {
  const { module } = loadController("win32");
  const size = 16;
  for (const [kind, { color, glyph }] of Object.entries(BADGE_STATES)) {
    const buffer = module.createStatusBadgeBitmap(size, color, glyph);
    assert.equal(buffer.length, size * size * 4, `${kind}: bitmap size`);
    // A disc, not a tile: every corner stays fully transparent.
    for (const [x, y] of [
      [0, 0],
      [size - 1, 0],
      [0, size - 1],
      [size - 1, size - 1],
    ]) {
      assert.equal(pixel(buffer, size, x, y).alpha, 0, `${kind}: corner ${x},${y}`);
    }
    // The disc reaches both edges of the 16px box on its equator, so no ring or
    // margin eats the badge before Windows scales it for the taskbar.
    for (let x = 0; x < size; x += 1) {
      assert.equal(pixel(buffer, size, x, size / 2).alpha, 255, `${kind}: equator ${x}`);
    }
    // Its outermost pixel is ink; the state colour fills the rest.
    assert.ok(isInk(pixel(buffer, size, 0, size / 2)), `${kind}: rim carries the ink`);
    const fill = pixel(buffer, size, 2, size / 2);
    assert.deepEqual(
      [fill.red, fill.green, fill.blue],
      hexRgb(color),
      `${kind}: fill is the state colour`,
    );
  }
});

test("every state glyph is ink at a readable contrast and clears the rim", () => {
  const { module } = loadController("win32");
  for (const size of [16, 32]) {
    for (const [kind, { color, glyph }] of Object.entries(BADGE_STATES)) {
      const label = `${kind}@${size}`;
      // D451 ink on the light status tokens. A white glyph would measure only
      // 2.1-2.9:1 against these fills and read as a smudge at taskbar size.
      const ratio = contrastRatio(INK, hexRgb(color));
      assert.ok(ratio >= 4.5, `${label}: ink contrast is ${ratio.toFixed(2)}:1`);
      const buffer = module.createStatusBadgeBitmap(size, color, glyph);
      const radius = size / 2;
      const fillRadius = radius - size / 16;
      // The glyph is a mark in the middle of the badge, the rim is the badge's
      // own edge, and neither may swallow the other.
      let coreInk = 0;
      let glyphInk = 0;
      let rimInk = 0;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          if (!isMajorityInk(pixel(buffer, size, x, y), color)) continue;
          const distance = Math.hypot(x + 0.5 - radius, y + 0.5 - radius);
          if (distance >= fillRadius) rimInk += 1;
          else if (distance <= fillRadius - 1) glyphInk += 1;
          if (distance <= 3) coreInk += 1;
        }
      }
      assert.ok(coreInk >= 1, `${label}: no mark in the middle of the badge`);
      assert.ok(glyphInk >= 4, `${label}: glyph ink pixels are ${glyphInk}`);
      assert.ok(rimInk >= 4, `${label}: rim ink pixels are ${rimInk}`);
    }
  }
});

test("the needs-input glyph keeps a bar, a gap and a dot at taskbar size", () => {
  const { module } = loadController("win32");
  const size = 16;
  const column = size / 2;
  let start = -1;
  const buffer = module.createStatusBadgeBitmap(size, "#c27aff", "exclaim");
  const runs = [];
  for (let y = 0; y < size; y += 1) {
    // The rim is not part of the glyph: read the fill's own vertical extent.
    const inside = Math.hypot(column + 0.5 - size / 2, y + 0.5 - size / 2) < size / 2 - 1;
    if (inside && isMajorityInk(pixel(buffer, size, column, y), "#c27aff")) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      runs.push({ start, length: y - start });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, length: size - start });
  assert.equal(
    runs.length,
    2,
    `a bar and a dot are expected, saw runs of ${runs.map((run) => run.length).join(",")}`,
  );
  assert.ok(runs[0].length >= 4, `bar is ${runs[0].length}px`);
  assert.ok(runs[1].length >= 2, `dot is ${runs[1].length}px`);
  const gap = runs[1].start - (runs[0].start + runs[0].length);
  assert.ok(gap >= 1, `bar and dot are only ${gap}px apart`);
});

test("Windows paints and clears the overlay icon with the localized description", () => {
  const { controller, calls } = loadController("win32");
  const applied = controller.apply({ kind: "attention", count: 2 });
  assert.deepEqual(
    { applied: applied.applied, kind: applied.kind, count: applied.count },
    { applied: true, kind: "attention", count: 2 },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].description, "PI-Desktop needs your input");
  assert.ok(calls[0].image && typeof calls[0].image.addRepresentation === "function");
  controller.apply({ kind: "none", count: 0 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].image, null);
  assert.equal(calls[1].description, "");
});

test("a missing window reports no-window instead of throwing", () => {
  const { controller } = loadController("win32", { noWindow: true });
  const applied = controller.apply({ kind: "running", count: 1 });
  assert.equal(applied.applied, false);
  assert.equal(applied.reason, "no-window");
});

test("macOS uses the Dock badge and Linux reports unsupported", () => {
  const mac = loadController("darwin");
  assert.equal(mac.controller.apply({ kind: "failed", count: 1 }).applied, true);
  assert.deepEqual(mac.dockBadges, ["✕"]);
  mac.controller.apply({ kind: "none", count: 0 });
  assert.deepEqual(mac.dockBadges, ["✕", ""]);

  const linux = loadController("linux");
  const applied = linux.controller.apply({ kind: "completed", count: 3 });
  assert.equal(applied.applied, false);
  assert.equal(applied.reason, "unsupported");
});

test("the protocol, API, and IPC wiring stay in sync", () => {
  const protocol = fs.readFileSync(
    new URL("../../../packages/shared/src/protocol.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    protocol,
    /windowSetTaskbarStatus:\s*"pi-desktop\/window\/setTaskbarStatus"/,
  );
  const api = fs.readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
  assert.match(
    api,
    /setTaskbarStatus:\s*\(snapshot:\s*TaskbarStatusSnapshot\)[\s\S]*?IPC\.invoke\.windowSetTaskbarStatus/,
  );
  const windowIpc = fs.readFileSync(
    new URL("../electron/main/ipc/window-ipc.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    windowIpc,
    /handle\(IPC\.invoke\.windowSetTaskbarStatus,[\s\S]*?isTaskbarStatusSnapshot\(snapshot\)[\s\S]*?taskbarStatus\.apply\(snapshot\)/,
  );
  const shell = fs.readFileSync(
    new URL("../src/features/app/useAppShellRuntime.tsx", import.meta.url),
    "utf8",
  );
  assert.match(shell, /useTaskbarStatus\(\)/);
});
