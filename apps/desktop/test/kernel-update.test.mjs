import {
  readMainModule,
  readMainSource,
  readSettingsSource,
  readSharedTypesSource,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

/** Every shipped locale must carry the same key shape (catalogs are typed). */
const LOCALES = ["en", "zh-CN", "zh-TW", "de", "es", "fr", "ko", "tr"];

const [
  protocolSource,
  typesSource,
  mainSource,
  appIpcSource,
  kernelUpdateSource,
  apiSource,
  settingsSearchSource,
  settingsSource,
  kernelRowSource,
  runtimeKernelSource,
  runtimeIndexSource,
  ...localeSources
] = await Promise.all([
  read("../../../packages/shared/src/protocol.ts"),
  readSharedTypesSource(),
  readMainSource(),
  readMainModule("ipc/app-ipc.ts"),
  readMainModule("kernel-update.ts"),
  read("../src/lib/api.ts"),
  read("../src/lib/settings-search.ts"),
  readSettingsSource(),
  read("../src/features/settings/kernel-row.tsx"),
  read("../../../packages/agent-runtime/src/kernel-version.ts"),
  read("../../../packages/agent-runtime/src/index.ts"),
  ...LOCALES.map((locale) =>
    read(`../../../packages/i18n/src/locales/${locale}/index.ts`),
  ),
]);

test("the kernel check and release channels are declared and registered by Main", () => {
  assert.match(
    protocolSource,
    /kernelCheckUpdate:\s*"pi-desktop\/kernel\/checkUpdate"/,
    "the invoke channel is declared in the shared IPC map",
  );
  assert.match(
    protocolSource,
    /kernelOpenReleases:\s*"pi-desktop\/kernel\/openReleases"/,
    "the kernel release page has its own channel",
  );
  assert.match(mainSource, /import \{ checkKernelUpdate \} from "\.\.\/kernel-update"/);
  assert.match(
    appIpcSource,
    /handle\(IPC\.invoke\.kernelCheckUpdate, async \(\) => checkKernelUpdate\(\)\)/,
    "Main answers the kernel check on the declared channel",
  );
  assert.match(
    appIpcSource,
    /handle\(IPC\.invoke\.kernelOpenReleases,[\s\S]*?safeOpenExternal\(PI_KERNEL_RELEASES_URL\)/,
    "Main opens the kernel's own release page through the URL gate",
  );
  assert.doesNotMatch(
    appIpcSource,
    /kernelOpenReleases[\s\S]{0,200}updater\.openReleases/,
    "the kernel action must not open the PI-Desktop releases page",
  );
});

test("app/getVersion carries the bundled kernel version", () => {
  assert.match(typesSource, /kernelVersion\?: string/);
  assert.match(typesSource, /export type KernelUpdateResult = \{/);
  assert.match(typesSource, /updateAvailable: boolean/);
  assert.match(
    appIpcSource,
    /kernelVersion: PI_KERNEL_VERSION/,
    "Main reports the kernel version resolved from the runtime package",
  );
  assert.match(
    appIpcSource,
    /import \{[\s\S]*?PI_KERNEL_RELEASES_URL,[\s\S]*?PI_KERNEL_VERSION,[\s\S]*?\} from "@pi-desktop\/agent-runtime"/,
    "Main reads the kernel identity from the runtime package",
  );
});

test("the agent runtime owns the kernel version and its comparison", () => {
  assert.match(
    runtimeKernelSource,
    /import kernelPackage from "@earendil-works\/pi-agent-core\/package\.json"/,
    "the version is resolved from the pinned dependency at build time",
  );
  assert.match(runtimeKernelSource, /export const PI_KERNEL_VERSION: string/);
  assert.match(runtimeKernelSource, /export function parseKernelVersion/);
  assert.match(runtimeKernelSource, /export function isNewerKernelVersion/);
  assert.match(runtimeIndexSource, /export \* from "\.\/kernel-version\.js"/);
  assert.match(runtimeKernelSource, /export function kernelRepositoryUrl/);
  assert.match(runtimeKernelSource, /export const PI_KERNEL_RELEASES_URL: string \| null/);
});

test("the check reads the public npm registry and never swaps the kernel", () => {
  assert.match(
    kernelUpdateSource,
    /https:\/\/registry\.npmjs\.org\/@earendil-works%2Fpi-agent-core\/latest/,
    "the newest published kernel version is the only upstream source",
  );
  assert.match(kernelUpdateSource, /createPublicHttpsClient\(\{/);
  assert.match(kernelUpdateSource, /net\.fetch\(url, init\)/);
  assert.match(
    kernelUpdateSource,
    /parseKernelVersion\(latestVersion\)/,
    "an unexpected registry payload is refused instead of compared",
  );
  assert.match(
    kernelUpdateSource,
    /isNewerKernelVersion\(latestVersion, PI_KERNEL_VERSION\)/,
  );
  assert.doesNotMatch(
    kernelUpdateSource,
    /npm-installer|electron-updater/,
    "a kernel update ships with an app release; this check must not install anything",
  );
});

test("the renderer exposes the check and the Info page shows the kernel row", () => {
  assert.match(
    apiSource,
    /kernelCheckUpdate: \(\) => invoke<KernelUpdateResult>\(IPC\.invoke\.kernelCheckUpdate\)/,
  );
  assert.match(
    settingsSource,
    /<KernelUpdateRow kernelVersion=\{version\?\.kernelVersion\} \/>/,
  );
  assert.match(kernelRowSource, /api\.kernelCheckUpdate\(\)/);
  assert.match(kernelRowSource, /kernel\.title/);
  assert.match(kernelRowSource, /kernel\.desc/);
  assert.match(kernelRowSource, /kernel\.upToDate/);
  assert.match(kernelRowSource, /kernel\.available/);
  assert.match(kernelRowSource, /kernel\.error/);
  assert.match(
    apiSource,
    /kernelOpenReleases: \(\) => invoke\(IPC\.invoke\.kernelOpenReleases\)/,
  );
  assert.match(
    kernelRowSource,
    /api\.kernelOpenReleases\(\)/,
    "a newer kernel points at the kernel's own release page",
  );
  assert.doesNotMatch(
    kernelRowSource,
    /updatesOpenReleases/,
    "the kernel row must never open the PI-Desktop releases page",
  );
  assert.match(
    kernelRowSource,
    /alive\.current/,
    "a result that lands after the page closed is dropped",
  );
  assert.match(settingsSearchSource, /"kernel\.title"/);
});

test("every shipped locale carries the kernel strings", () => {
  localeSources.forEach((source, index) => {
    const locale = LOCALES[index];
    assert.match(source, /kernel: \{|"kernel": \{/, locale);
    for (const key of [
      "title",
      "desc",
      "check",
      "checking",
      "upToDate",
      "available",
      "error",
    ]) {
      assert.match(
        source,
        new RegExp(`"?${key}"?:`),
        `${locale} is missing kernel.${key}`,
      );
    }
  });
});
