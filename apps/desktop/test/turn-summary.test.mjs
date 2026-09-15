import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { firstChangedLine, turnFileChanges, turnFilesTotal } = await import(
  "../src/lib/turn-files.ts"
);
const { turnArtifacts, MAX_TURN_ARTIFACTS } = await import(
  "../src/lib/turn-artifacts.ts"
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

test("firstChangedLine returns the first added or removed line", () => {
  assert.equal(
    firstChangedLine({
      hunks: [
        {
          header: "@@ -1 +1,2 @@",
          lines: [
            { type: "context", text: "unchanged" },
            { type: "add", text: "  added line  " },
          ],
        },
      ],
    }),
    "added line",
  );
  // A diff with context only says nothing about the edit.
  assert.equal(
    firstChangedLine({ hunks: [{ header: "@@", lines: [{ type: "context", text: "x" }] }] }),
    "",
  );
  assert.equal(firstChangedLine({ hunks: [] }), "");
});

test("turnFileChanges carries the latest change preview", () => {
  const entry = turnEntry([
    toolMessage("m1", "src/a.ts", "modified", {
      hunks: [
        { header: "@@", lines: [{ type: "add", text: "first edit" }] },
      ],
    }),
    toolMessage("m2", "src/a.ts", "modified", {
      hunks: [
        { header: "@@", lines: [{ type: "add", text: "second edit" }] },
      ],
    }),
  ]);
  const files = turnFileChanges(entry);
  assert.equal(files[0].preview, "second edit");
});

function assistantTurn(text) {
  return {
    kind: "assistant-turn",
    id: "turn-artifacts",
    parts: [
      { kind: "message", message: { id: "a1", role: "assistant", content: text } },
    ],
  };
}

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);

test("turnArtifacts reads reported outputs from the final answer", () => {
  const entry = assistantTurn(
    [
      "Packaged the release.",
      "Installer: E:" + BS + "pi-pro" + BS + "out" + BS + "Setup-1.0.0.exe",
      "modified src/a.ts",
    ].join(NL),
  );
  const artifacts = turnArtifacts(entry, "E:/ws", ["src/a.ts"]);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].path, "E:/pi-pro/out/Setup-1.0.0.exe");
  assert.equal(artifacts[0].external, true);
  assert.match(artifacts[0].note, /Installer/);
});

test("turnArtifacts dedupes, skips urls, and caps the list", () => {
  const lines = [];
  for (let i = 0; i < MAX_TURN_ARTIFACTS + 5; i += 1) {
    lines.push(`out/file-${i}.bin`);
  }
  lines.push("out/file-0.bin", "see https://example.com/page");
  const artifacts = turnArtifacts(assistantTurn(lines.join(NL)), "/ws");
  assert.equal(artifacts.length, MAX_TURN_ARTIFACTS);
  const paths = artifacts.map((artifact) => artifact.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.every((path) => !path.startsWith("http")));
});

test("turnArtifacts is empty without an answer", () => {
  assert.deepEqual(turnArtifacts(assistantTurn("   "), "/ws"), []);
});

const readSource = async (relative) =>
  (await import("node:fs/promises")).readFile(new URL(relative, import.meta.url), "utf8");

const cardSource = await readSource("../src/components/TurnSummaryCard.tsx");
const rowsSource = await readSource("../src/components/TurnSummaryRows.tsx");
const tableSource = await readSource("../src/components/TurnSummaryTable.tsx");

const LOCALES = ["en", "zh-CN", "zh-TW", "de", "es", "fr", "ko", "tr"];

test("the summary renders changes and outputs as tables", () => {
  assert.match(tableSource, /<table className="turn-summary-table">/);
  assert.match(cardSource, /<SummaryTable title={t\("chat.summaryChangesTitle"\)}/);
  assert.match(cardSource, /<SummaryTable title={t\("chat.summaryArtifactsTitle"\)}/);
  assert.match(cardSource, /stat={existence\[/);
});

test("a row whose file is gone shows the hint and disables its actions", () => {
  assert.match(tableSource, /chat.summaryMissingFile/);
  assert.match(rowsSource, /missing \? <MissingHint \/> : null/);
  assert.match(tableSource, /disabled={missing}/);
});

test("every shipped locale carries the summary labels", async () => {
  const keys = [
    "summaryChangesTitle",
    "summaryArtifactsTitle",
    "summaryColumnContent",
    "summaryColumnPath",
    "summaryColumnActions",
    "summaryMissingFile",
    "summaryNoChanges",
  ];
  for (const locale of LOCALES) {
    const text = await readSource(
      `../../../packages/i18n/src/locales/${locale}/index.ts`,
    );
    for (const key of keys) {
      assert.ok(text.includes(key), `${locale} is missing ${key}`);
    }
    assert.match(text, /summaryOp: {/, `${locale} is missing summaryOp`);
    for (const op of ["added", "modified", "deleted"]) {
      assert.ok(text.includes(`${op}:`), `${locale} is missing summaryOp.${op}`);
    }
  }
});
