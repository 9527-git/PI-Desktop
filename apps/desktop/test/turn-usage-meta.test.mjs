import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { formatMessageTimestamp } from "../src/lib/message-time.ts";

const shared = fs.readFileSync(
  new URL("../src/features/chat/transcript/shared.tsx", import.meta.url),
  "utf8",
);
const turn = fs.readFileSync(
  new URL("../src/features/chat/transcript/AssistantTurn.tsx", import.meta.url),
  "utf8",
);
const row = fs.readFileSync(
  new URL("../src/features/chat/transcript/MessageRow.tsx", import.meta.url),
  "utf8",
);
const css = fs.readFileSync(
  new URL("../src/styles/messages.css", import.meta.url),
  "utf8",
);

test("today's messages stamp with the clock time only", () => {
  const now = new Date();
  const stamp = formatMessageTimestamp(now.toISOString(), "en-US");
  assert.match(stamp, /^\d{1,2}:\d{2}/);
});

test("older messages stamp with a short date plus time and no repeated year", () => {
  const earlier = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stamp = formatMessageTimestamp(earlier.toISOString(), "en-US");
  assert.match(stamp, /^\S+ .*\d{1,2}:\d{2}/);
  const yearsAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
  assert.doesNotMatch(
    formatMessageTimestamp(yearsAgo.toISOString(), "en-US"),
    /^\d{4}/,
  );
});

test("an unparseable timestamp renders as empty", () => {
  assert.equal(formatMessageTimestamp("not-a-date", "en-US"), "");
});

test("the meta row shows per-turn input, output, and cache usage chips", () => {
  assert.match(shared, /message-meta-chip usage/);
  assert.match(shared, /chat\.usageInput/);
  assert.match(shared, /chat\.usageOutput/);
  assert.match(shared, /chat\.usageCacheRead/);
  assert.match(shared, /chat\.usageCacheWrite/);
  // Cache chips appear only when the usage carries them.
  assert.match(shared, /usage\.cacheReadTokens \? \(/);
  assert.match(shared, /usage\.cacheWriteTokens \? \(/);
});

test("assistant turns stamp with the turn's last message time", () => {
  assert.match(
    turn,
    /const turnTimestamp = messages\[messages\.length - 1\]\?\.createdAt;/,
  );
  assert.match(
    turn,
    /<MessageMeta[\s\S]*?timestamp=\{turnTimestamp\}/,
  );
});

test("single message rows stamp with the message time while not editing", () => {
  assert.match(
    row,
    /\{!editing && message\.createdAt \? \(\s*\n\s*<MessageMeta timestamp=\{message\.createdAt\} \/>/,
  );
});

test("usage and time chips use tabular numerals", () => {
  assert.match(
    css,
    /\.message-meta-chip\.usage,\s*\n\.message-meta-chip\.time \{\s*\n\s*font-variant-numeric: tabular-nums;/,
  );
});
