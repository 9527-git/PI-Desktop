import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptSource = await readFile(
  new URL("../../../build-win.ps1", import.meta.url),
  "utf8",
);
const gitignoreSource = await readFile(
  new URL("../../../.gitignore", import.meta.url),
  "utf8",
);

test("Windows packaging publishes one folder per version", () => {
  assert.match(
    scriptSource,
    /Join-Path \(Join-Path \$Root 'release'\) \$appVersion/,
  );
  assert.match(scriptSource, /Publishing to release\/\$appVersion/);
  assert.doesNotMatch(scriptSource, /Join-Path \$Root \$pkg\.Name/);
});

test("an incomplete publish fails the build instead of reporting success", () => {
  assert.match(scriptSource, /release\/\$appVersion is incomplete/);
  assert.match(scriptSource, /\$missing = @\(\$expected \|/);
});

test("the per-version delivery folder is ignored instead of loose installers", () => {
  assert.match(gitignoreSource, /^\/release\/$/m);
  assert.doesNotMatch(gitignoreSource, /^\/\*\.exe$/m);
});