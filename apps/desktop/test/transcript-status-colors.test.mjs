import { readTranscriptSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * Status colour is the transcript's second channel beside the label: every
 * status-bearing surface renders its state through the semantic token its
 * sidebar twin already uses (07-ui-design-system 4.6), and success stays
 * neutral apart from its dot (D227). The rules live in CSS and className
 * hooks, where nothing else would notice them drifting apart.
 */

const transcript = await readTranscriptSource();
const styles = await readFile(
  new URL("../src/styles/messages.css", import.meta.url),
  "utf8",
);

test("the tool icon carries the row's state colour", () => {
  assert.match(
    styles,
    /\.tool-row\.status-running \.tool-row-icon \{\s*color: var\(--ds-warning\);/,
  );
  assert.match(
    styles,
    /\.tool-row\.status-error \.tool-row-icon \{\s*color: var\(--ds-error\);/,
  );
  assert.match(
    styles,
    /\.tool-row\.status-denied \.tool-row-icon \{\s*color: var\(--ds-purple\);/,
  );
  // Success never shouts: a finished row earns only its green dot.
  assert.doesNotMatch(styles, /\.tool-row\.status-success \.tool-row-icon/);
});

test("a denied call labels itself in the permission purple", () => {
  assert.match(transcript, /className="tool-row-status denied"/);
  assert.match(styles, /\.tool-row-status\.denied \{\s*color: var\(--ds-purple\);/);
});

test("the running marker and spinner carry the sidebar warning", () => {
  assert.match(
    styles,
    /\.tool-activity-label\.running::after,\s*\.tool-row-name\.running::after \{[\s\S]*?background: var\(--ds-warning\);[\s\S]*?animation: activity-marker-pulse/,
  );
  assert.match(
    styles,
    /\.tool-spinner \{[\s\S]*?border: 1\.5px solid color-mix\(in oklab, var\(--ds-warning\) 30%, transparent\);[\s\S]*?border-top-color: var\(--ds-warning\);/,
  );
});

test("a live activity group tints its header icon", () => {
  assert.match(
    styles,
    /\.tool-activity-group\.active \.tool-activity-icon \{\s*color: var\(--ds-warning\);/,
  );
});

test("the topology badge shows its outcome, denial included", () => {
  assert.match(
    styles,
    /\.subagent-topology-node\.outcome-running \.subagent-topology-status-icon \{\s*background: var\(--ds-warning\);\s*animation: tool-row-state-pulse 1\.1s ease-in-out infinite;/,
  );
  assert.match(
    styles,
    /\.subagent-topology-node\.outcome-denied \.subagent-topology-status-icon \{\s*background: var\(--ds-purple\);/,
  );
  // Abort stays neutral on purpose: a stop is not a failure.
  assert.match(
    styles,
    /\.subagent-topology-node\.outcome-aborted \.subagent-topology-status-icon \{\s*background: var\(--ds-text-muted\);\s*\}/,
  );
});

test("a streaming reply keeps a blinking caret on the growing prose", () => {
  assert.match(
    styles,
    /\.assistant-turn-fragment\.streaming \.prose-chat > :last-child::after \{[\s\S]*?animation: stream-caret-blink 1s var\(--motion-ease-standard\) infinite;/,
  );
  assert.match(styles, /@keyframes stream-caret-blink \{/);
});
