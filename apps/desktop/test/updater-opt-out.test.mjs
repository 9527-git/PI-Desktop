import assert from "node:assert/strict";
import * as fs from "node:fs";
import test from "node:test";
import ts from "typescript";

/**
 * Behavioral coverage for the D437/D472 opt-out transition.
 *
 * `updater.ts` imports Electron and electron-updater, so the harness compiles
 * it as CommonJS and replaces both with a fake autoUpdater. That lets the test
 * drive the real controller through an automatic discovery followed by the
 * user turning automatic checks off.
 */
function loadUpdater({ isAutoCheckEnabled = true, platform = "win32" } = {}) {
  const file = new URL("../electron/main/updater.ts", import.meta.url);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    fileName: file.pathname,
  });

  const listeners = new Map();
  const state = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    logger: null,
    checkForUpdates: async () => null,
    downloadUpdate: async () => [],
    quitAndInstall: () => undefined,
    on(event, listener) {
      const bucket = listeners.get(event) ?? [];
      bucket.push(listener);
      listeners.set(event, bucket);
    },
  };
  const emitted = [];
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)(
    (id) => {
      if (id === "electron") {
        return {
          app: { isPackaged: true, getAppPath: () => "" },
          shell: { openExternal: async () => undefined },
        };
      }
      if (id === "electron-updater") {
        return { default: { autoUpdater: state }, autoUpdater: state };
      }
      if (id === "@pi-desktop/shared") {
        return {
          IPC: { event: { updatesState: "pi-desktop/updates/event/state" } },
          formatChangelogNotes: () => undefined,
        };
      }
      if (id === "./safe-open-external") {
        return { parseAllowedExternalUrl: () => null };
      }
      if (id === "./update-timeout") {
        return {
          raceWithTimeout: (promise) => promise,
          UPDATE_CHECK_TIMEOUT_CODE: "UPDATE_CHECK_TIMEOUT",
        };
      }
      throw new Error(`unexpected updater dependency: ${id}`);
    },
    module.exports,
    module,
  );

  // The developer shell may itself be a portable launch; the mode under test
  // must be a normal Windows NSIS install.
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  delete process.env.PORTABLE_EXECUTABLE_FILE;
  let controller;
  try {
    controller = new module.exports.AppUpdaterController({
      logger: { app: () => undefined },
      send: (_channel, payload) => emitted.push(payload),
      currentVersion: "1.0.0",
      isPackaged: true,
      platform,
      isAutoCheckEnabled: () => isAutoCheckEnabled,
    });
  } finally {
    if (portable === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE;
    else process.env.PORTABLE_EXECUTABLE_FILE = portable;
  }
  const emit = (event, payload) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  return { controller, state, emit, emitted, listeners };
}

test("turning automatic checks off retracts an automatically discovered update", () => {
  const { controller, state, emit } = loadUpdater();
  emit("update-available", { version: "2.0.0" });
  assert.equal(controller.getState().availableVersion, "2.0.0");

  controller.setAutoCheckEnabled(false);

  const next = controller.getState();
  assert.equal(next.status, "idle");
  assert.equal(next.availableVersion, undefined);
  assert.equal(next.releaseNotes, undefined);
  assert.equal(next.progressPercent, undefined);
  assert.equal(state.autoDownload, false);
  assert.equal(state.autoInstallOnAppQuit, false);
});

test("a manual result stays visible after automatic checks are turned off", async () => {
  const { controller, state, emit } = loadUpdater();
  state.checkForUpdates = async () => ({ isUpdateAvailable: true });
  await controller.check({ manual: true });
  emit("update-available", { version: "2.0.0" });
  assert.equal(controller.getState().manual, true);

  controller.setAutoCheckEnabled(false);

  assert.equal(controller.getState().availableVersion, "2.0.0");
  assert.equal(controller.getState().manual, true);
  assert.equal(state.autoDownload, true, "a manual in-app check may still download");
  assert.equal(state.autoInstallOnAppQuit, true);
});

test("automatic update events that arrive after the opt-out are ignored", () => {
  const { controller, emit } = loadUpdater();
  controller.setAutoCheckEnabled(false);
  emit("update-available", { version: "2.0.0" });
  assert.equal(controller.getState().status, "idle");
  assert.equal(controller.getState().availableVersion, undefined);
});

test("turning automatic checks back on restores automatic download policy", () => {
  const { controller, state } = loadUpdater();
  controller.setAutoCheckEnabled(false);
  assert.equal(state.autoDownload, false);
  controller.setAutoCheckEnabled(true);
  assert.equal(state.autoDownload, true);
  assert.equal(state.autoInstallOnAppQuit, true);
});

test("an opt-out cancels a download the automatic check had started", async () => {
  const { controller, state, listeners } = loadUpdater();
  let cancelled = false;
  state.checkForUpdates = async () => {
    for (const listener of listeners.get("update-available") ?? []) {
      listener({ version: "2.0.0" });
    }
    return {
      isUpdateAvailable: true,
      downloadPromise: new Promise(() => undefined),
      cancellationToken: { cancel: () => (cancelled = true) },
    };
  };


  await controller.check();
  assert.equal(controller.getState().availableVersion, "2.0.0");
  controller.setAutoCheckEnabled(false);
  assert.equal(cancelled, true);
  assert.equal(controller.getState().status, "idle");
});

test("an opt-out during an in-flight automatic check never starts a download", async () => {
  const { controller, state, listeners } = loadUpdater();
  const downloads = [];
  state.downloadUpdate = async () => {
    downloads.push("started");
    return [];
  };
  let release;
  state.checkForUpdates = () =>
    new Promise((resolve) => {
      release = () =>
        resolve({
          isUpdateAvailable: true,
          downloadPromise: null,
          cancellationToken: { cancel: () => undefined },
        });
    });

  const inFlight = controller.check();
  controller.setAutoCheckEnabled(false);
  release();
  await inFlight;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(downloads, [], "no download may start after the opt-out");
  assert.equal(controller.getState().status, "idle");
  assert.equal(controller.getState().availableVersion, undefined);
  assert.equal(
    listeners.get("update-available")?.length,
    1,
    "the listener stays attached; the gate is the origin check",
  );
});
