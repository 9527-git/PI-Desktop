import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
// Node strips the types itself; the hook only supplies the `.ts` extension the
// bundler-style relative imports omit.
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { holdCompactionSession, isCompactionOccupied } = await import(
  "../electron/main/runtime/compaction-occupancy.ts"
);
const { createSessionCoordination } = await import(
  "../electron/main/runtime/session-coordination.ts"
);

function createCoordination() {
  const activeTurns = new Map();
  const coordination = createSessionCoordination({
    activeTurns,
    getMainWindow: () => null,
    getViewingSessionId: () => null,
  });
  return { activeTurns, coordination };
}

test("a manual compaction holds its own session and no other", () => {
  const { coordination } = createCoordination();
  assert.equal(coordination.isSessionBusy("s1"), false);
  const release = holdCompactionSession("s1");
  assert.equal(coordination.isSessionBusy("s1"), true);
  assert.equal(coordination.isSessionBusy("s2"), false);
  release();
  assert.equal(coordination.isSessionBusy("s1"), false);
});

test("the hold is reference counted and its release is idempotent", () => {
  const { coordination } = createCoordination();
  const first = holdCompactionSession("s1");
  const second = holdCompactionSession("s1");
  first();
  assert.equal(isCompactionOccupied("s1"), true);
  assert.equal(coordination.isSessionBusy("s1"), true);
  first();
  assert.equal(isCompactionOccupied("s1"), true);
  second();
  assert.equal(isCompactionOccupied("s1"), false);
  assert.equal(coordination.isSessionBusy("s1"), false);
});

test("a blank session id holds nothing", () => {
  const release = holdCompactionSession("   ");
  assert.equal(isCompactionOccupied("   "), false);
  release();
});

test("a live turn keeps the session busy across a released hold", () => {
  const { activeTurns, coordination } = createCoordination();
  activeTurns.set("s1", "t1");
  assert.equal(coordination.isSessionBusy("s1"), true);
  holdCompactionSession("s1")();
  assert.equal(coordination.isSessionBusy("s1"), true);
});
