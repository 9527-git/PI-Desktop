import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { inlineMarkdownNodes } = await import("../src/lib/markdown-inline.ts");

test("bold payload excludes its delimiters and terminates", () => {
  // Regression: the payload once carried the whole match, so the bold branch
  // re-tokenized its own `**` delimiters and overflowed the stack on every
  // row summary containing bold — opening such a session crashed the app.
  assert.deepEqual(inlineMarkdownNodes("**bold**"), [
    { kind: "bold", children: [{ kind: "text", text: "bold" }] },
  ]);
});

test("code span payload excludes its backticks", () => {
  assert.deepEqual(inlineMarkdownNodes("`core thing`"), [
    { kind: "code", text: "core thing" },
  ]);
});

test("a row summary mixes bold, code, and path spans", () => {
  assert.deepEqual(
    inlineMarkdownNodes("**Write** `src/a.ts` to src/b.ts"),
    [
      { kind: "bold", children: [{ kind: "text", text: "Write" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "src/a.ts" },
      { kind: "text", text: " to " },
      { kind: "path", text: "src/b.ts" },
    ],
  );
});

test("a URL stays literal text", () => {
  assert.deepEqual(inlineMarkdownNodes("http://x.dev/a"), [
    { kind: "text", text: "http://x.dev/a" },
  ]);
});

test("single-asterisk globs survive as plain text", () => {
  assert.deepEqual(inlineMarkdownNodes("src/*.ts"), [
    { kind: "text", text: "src/*.ts" },
  ]);
});

test("plain text and empty input pass through", () => {
  assert.deepEqual(inlineMarkdownNodes("no markup"), [
    { kind: "text", text: "no markup" },
  ]);
  assert.deepEqual(inlineMarkdownNodes(""), []);
});

test("bold-heavy summaries tokenize without a stack overflow", () => {
  const source = "**step** ".repeat(200).trim();
  const nodes = inlineMarkdownNodes(source);
  assert.equal(nodes.length, 399);
  assert.equal(nodes[0].kind, "bold");
});
