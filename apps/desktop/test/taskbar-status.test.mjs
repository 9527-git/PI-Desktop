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

test("the badge bitmap is a transparent-cornered BGRA circle in its state colour", () => {
  const { module } = loadController("win32");
  const size = 16;
  const buffer = module.createStatusBadgeBitmap(size, "#ff8549", "dot");
  assert.equal(buffer.length, size * size * 4);
  const alphaAt = (x, y) => buffer[(y * size + x) * 4 + 3];
  // Corners are fully transparent; the ring's left edge is opaque white.
  assert.equal(alphaAt(0, 0), 0);
  assert.equal(alphaAt(size - 1, 0), 0);
  assert.equal(alphaAt(0, size - 1), 0);
  assert.equal(alphaAt(size - 1, size - 1), 0);
  assert.equal(alphaAt(1, size / 2), 255);
  // The fill inside the white ring carries the state colour in BGRA order:
  // #ff8549 -> B=0x49, G=0x85, R=0xff.
  const offset = ((size / 2) * size + size / 2) * 4;
  assert.equal(buffer[offset], 0x49);
  assert.equal(buffer[offset + 1], 0x85);
  assert.equal(buffer[offset + 2], 0xff);
  assert.equal(buffer[offset + 3], 255);
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
