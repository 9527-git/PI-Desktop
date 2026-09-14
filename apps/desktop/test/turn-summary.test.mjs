import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { turnFileChanges, turnFilesTotal } = await import(
  "../src/lib/turn-files.ts"
);
const diffSource = await (await import("node:fs/promises")).readFile(
  new URL("../src/components/ReviewChangeDiff.tsx", import.meta.url),
  "utf8",
);

function toolMessage(id, path, status, overrides = {}) {
  return {
    id,
    role: "tool",
    toolName: "Write",
    toolStatus: "success",
    toolCallId: `call-${id}`,
    toolResult: {
      details: {
        root: "workspace",
        review: {
          version: 1,
          snapshotId: `snap-${id}`,
          messageId: id,
          path,
          operation: "write",
          status,
          state: "active",
          additions: 3,
          deletions: 1,
          hunks: [],
          reversible: true,
          ...overrides,
        },
      },
    },
  };
}

function turnEntry(messages) {
  return {
    kind: "assistant-turn",
    id: "turn-1",
    parts: messages.map((message) => ({
      kind: "activity",
      items: [{ kind: "tool", message }],
    })),
  };
}

test("turnFileChanges aggregates per path and sums totals", () => {
  const entry = turnEntry([
    toolMessage("m1", "src/a.ts", "modified"),
    toolMessage("m2", "src/a.ts", "modified"),
    toolMessage("m3", "docs/new.md", "added"),
  ]);
  const files = turnFileChanges(entry);
  assert.equal(files.length, 2);
  const a = files.find((f) => f.path === "src/a.ts");
  assert.equal(a.status, "modified");
  assert.equal(a.additions, 6);
  assert.equal(a.deletions, 2);
  assert.equal(a.records.length, 2);
  const total = turnFilesTotal(files);
  assert.deepEqual(total, { additions: 9, deletions: 3 });
});

test("turnFileChanges drops rolled-back records and applies delete-wins", () => {
  const entry = turnEntry([
    toolMessage("m1", "src/a.ts", "modified"),
    toolMessage("m2", "src/b.ts", "added", { state: "rolledBack" }),
    toolMessage("m3", "src/a.ts", "deleted", { operation: "delete" }),
  ]);
  const files = turnFileChanges(entry);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "src/a.ts");
  assert.equal(files[0].status, "deleted");
});

test("turnFileChanges keeps an added classification over later modifications", () => {
  const entry = turnEntry([
    toolMessage("m1", "src/c.ts", "added"),
    toolMessage("m2", "src/c.ts", "modified"),
  ]);
  const files = turnFileChanges(entry);
  assert.equal(files[0].status, "added");
});

test("ReviewChangeDiffBody keeps the hunk rendering the review card used", () => {
  assert.match(diffSource, /change\.hunks\.map/);
  assert.match(diffSource, /review-change-note/);
  assert.match(diffSource, /diff-line-sign/);
});
