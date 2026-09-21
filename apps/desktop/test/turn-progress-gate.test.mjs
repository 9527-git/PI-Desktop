import assert from "node:assert/strict";
import test from "node:test";
import { turnProgressGate } from "../src/features/chat/transcript/turn-progress-gate.ts";
import { readTranscriptModule } from "./helpers/source-contracts.mjs";

const turn = { kind: "assistant-turn", id: "turn-1", parts: [] };
const userRow = { kind: "message", message: { id: "m-1" } };
const divider = { kind: "compaction", mark: { id: "c-1" } };

const gate = (fields = {}) =>
  turnProgressGate({
    running: true,
    interrupted: false,
    tailEntry: turn,
    paneVisible: true,
    veilCovering: false,
    ...fields,
  });

/* ADR 0264: the card speaks for the running turn, not for the shape of the
 * transcript's tail. The turn itself opens it — a turn with no rows yet still
 * has its phase and its clock — while its steps come only from a tail entry
 * that belongs to that turn. */
test("the running turn opens the card and lends it its own entry", () => {
  const open = gate();
  assert.equal(open.open, true);
  assert.equal(open.entry, turn);
  assert.equal(open.onScreen, true);
});

test("a tail that is not the turn's own entry opens the card with no steps", () => {
  for (const tailEntry of [userRow, divider, undefined]) {
    const open = gate({ tailEntry });
    assert.equal(open.open, true, `open with tail ${tailEntry?.kind ?? "none"}`);
    assert.equal(open.entry, null);
    assert.equal(open.onScreen, true);
  }
});

test("an interruption stands the card down", () => {
  const interrupted = gate({ interrupted: true });
  assert.equal(interrupted.open, false);
  assert.equal(interrupted.entry, null);
  assert.equal(interrupted.onScreen, false);
});

test("a stopped turn stands the card down even with an assistant tail", () => {
  const stopped = gate({ running: false });
  assert.equal(stopped.open, false);
  assert.equal(stopped.entry, null);
  assert.equal(stopped.onScreen, false);
});

test("a hidden pane or a settling veil keeps the card mounted but off screen", () => {
  const hiddenPane = gate({ paneVisible: false });
  assert.equal(hiddenPane.open, true);
  assert.equal(hiddenPane.entry, turn);
  assert.equal(hiddenPane.onScreen, false);
  const settling = gate({ veilCovering: true });
  assert.equal(settling.open, true);
  assert.equal(settling.onScreen, false);
});

/* Contract: the gate is a pure module — it reads nothing but its arguments
 * (ADR 0264) — and the overview keeps the step rows its own business. */
test("the gate module keeps the rule and reads nothing else", async () => {
  const [gateSource, overview] = await Promise.all([
    readTranscriptModule("turn-progress-gate.ts"),
    readTranscriptModule("TurnProgressOverview.tsx"),
  ]);
  assert.match(gateSource, /function turnProgressGate\(\{/);
  assert.match(gateSource, /const open = running && !interrupted;/);
  assert.match(
    gateSource,
    /entry: open && tailEntry\?\.kind === "assistant-turn" \? tailEntry : null,/,
  );
  assert.match(gateSource, /onScreen: open && paneVisible && !veilCovering,/);
  assert.match(
    gateSource,
    /import type \{ TranscriptEntry \} from "\.\.\/\.\.\/\.\.\/lib\/assistant-turns"/,
  );
  assert.doesNotMatch(gateSource, /useAppStore|api\.|window\.__pi|invoke\(/);
  assert.match(overview, /\{steps > 0 \? \(/);
  assert.doesNotMatch(overview, /filesChanged|additions|deletions/);
});
