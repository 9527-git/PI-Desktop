import assert from "node:assert/strict";
import * as fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { ErrorCodes } from "../../../packages/shared/src/errors.ts";
import { IPC } from "../../../packages/shared/src/protocol.ts";
import { piPackageFromPluginId } from "../../../packages/shared/src/pi-package.ts";
import {
  trustedExtensionCommandId,
  trustedExtensionCommandName,
} from "../../../packages/shared/src/trusted-extensions.ts";

/**
 * Load a main-process module with its dependencies replaced.
 *
 * `market-ipc.ts` pulls in the host process, the plugin runtime, the npm install
 * pipeline and the command palette. The search channel uses none of them, so the
 * harness hands it stubs and drives the registered handler directly — which is
 * the only layer between the renderer's page number and the host.
 */
function load(relative, imports) {
  const file = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: file.pathname,
  });
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)(
    (id) => {
      assert.ok(Object.hasOwn(imports, id), `unexpected IPC dependency: ${id}`);
      return imports[id];
    },
    module.exports,
    module,
  );
  return module.exports;
}

const shared = {
  ErrorCodes,
  IPC,
  trustedExtensionCommandId,
  trustedExtensionCommandName,
  piPackageFromPluginId,
};
const { registerMarketIpc } = load("../electron/main/ipc/market-ipc.ts", {
  "@pi-desktop/shared": shared,
  "../builtin-commands": { builtinPaletteItems: () => [] },
  "../pi-package-install": {
    applyPiPackageUpdates: async () => ({ results: [], failures: [] }),
    installPiPackage: async () => ({}),
    piPackageUpdates: () => [],
  },
});

function harness() {
  const handlers = new Map();
  const calls = [];
  registerMarketIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost: () => ({
      call: async (method, params) => {
        calls.push({ method, params });
        return { plugins: [], providerId: "pidev", sourceUrl: "", total: 0, pageSize: 100 };
      },
    }),
    plugins: {},
    agentExtensions: {},
    optionalWorkspaceRoot: async () => null,
    pluginActiveInProject: () => false,
    sendToRenderer: () => {},
    dataDir: "",
    log: () => {},
  });
  const search = handlers.get(IPC.invoke.marketSearch);
  assert.equal(typeof search, "function");
  return { search, calls };
}

test("market search hands the page offset it was asked for to the host", async () => {
  const { search, calls } = harness();
  const answer = await search({ query: "plan mode", category: "tools", offset: 200 });
  assert.deepEqual(calls, [
    {
      method: "market.search",
      params: { query: "plan mode", category: "tools", offset: 200 },
    },
  ]);
  // The host's own page description travels back untouched: the pager is drawn
  // from the size and the hit count the source reported.
  assert.equal(answer.pageSize, 100);
});

test("the first page stays a bare search and junk cannot page backwards", async () => {
  const { search, calls } = harness();
  await search({ query: "" });
  await search({ query: "", offset: -5 });
  await search({ query: "", offset: 12.7 });
  await search({ query: "", offset: Number.NaN });
  await search(undefined);
  assert.deepEqual(
    calls.map((call) => call.params.offset),
    [0, 0, 12, 0, 0],
  );
});
