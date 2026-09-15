import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readMainSource } from "./helpers/source-contracts.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [protocol, api, main, gate, panel] = await Promise.all([
  read("../../../packages/shared/src/protocol.ts"),
  read("../src/lib/api.ts"),
  readMainSource(),
  read("../electron/main/fs-open-gate.ts"),
  read("../electron/main/fs-panel.ts"),
]);

test("the existence probe is wired from the channel to the gate", () => {
  assert.match(protocol, /fsStat: "pi-desktop\/fs\/stat"/);
  assert.match(api, /fsStat: \(path: string\) =>/);
  assert.match(api, /invoke<FsPathStat>\(IPC\.invoke\.fsStat, \{ path \}\)/);
  assert.match(main, /IPC\.invoke\.fsStat/);
  assert.match(main, /statOpenablePath\(/);
  assert.match(gate, /export async function statOpenablePath\(/);
});

test("the probe reports a verdict and a kind, never content", () => {
  assert.match(gate, /return \{ exists: false, kind: null \}/);
  assert.match(gate, /kind: info\.isDirectory\(\) \? "dir" : "file"/);
  // The channel must not grow into a read or a listing: those already exist
  // with their own containment.
  assert.doesNotMatch(gate, /readFile|readdir|\.size/);
});

test("both OS handoffs fall back to the outside-the-workspace gate", () => {
  assert.match(gate, /export async function resolveLooseOpenablePath\(/);
  assert.match(gate, /realpath\(resolve\(raw\)\)/);
  assert.match(gate, /const insideProtected = protectedRoots\.some\(/);
  assert.match(main, /resolveLooseOpenablePath\(requested, \[dataDir\]\)/);
  // fs/open keeps its original refusal text and error code.
  assert.match(main, /"path is not openable"/);
  assert.match(main, /"path outside allowed roots"/);
});

test("reveal hands the resolved target to the file manager, not a bare call", () => {
  assert.match(gate, /export function revealTarget\(target: string, shell: RevealShell\)/);
  assert.match(gate, /shell\.showItemInFolder\(native\)/);
  assert.match(gate, /const parent = dirname\(cursor\)/);
  assert.match(main, /revealTarget\(target, shell\)/);
});

test("workspace-scoped containment is untouched by the handoff gate", () => {
  // The reader keeps the strict resolver: only the two user-initiated OS
  // actions gain the fallback (ADR 0256).
  assert.match(panel, /export function resolveOpenablePath\(/);
  assert.match(panel, /return allowed\.some\(\(root\) => pathIsWithin\(root, candidate\)\)/);
  assert.match(panel, /export async function readOpenableFile\(/);
  assert.doesNotMatch(panel, /resolveLooseOpenablePath|revealTarget|statOpenablePath/);
});
