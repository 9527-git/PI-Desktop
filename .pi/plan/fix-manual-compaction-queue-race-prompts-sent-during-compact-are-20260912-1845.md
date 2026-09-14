# Fix: prompts sent during a manual compaction are lost or bounce back to the composer

## Problem

User runs `/compact` (manual compaction), then sends a message while the compaction indicator ("正在压缩上下文…") is showing. The message either vanishes (failed queue entry, error toast only) or is restored back into the composer with an error row "session already has an active turn".

## Root cause (verified in code)

The runtime and Electron Main disagree about busy state during a manual compaction:

- Runtime (`packages/agent-runtime/src/runtime.ts:6510`): `getStatus().isRunning` is TRUE while `compactionInProgress || agentActivity !== undefined` — a compaction rejects new prompts via `assertNotRunning()` (AGENT_BUSY).
- Main (`apps/desktop/electron/main/index.ts:9558`): `isSessionBusy = activeTurns.has(sessionId) || turnFinalizations.has(sessionId)` — a manual compaction registers in **neither** map, so Main reports the session as idle.

Failure chain:

1. `/compact` → renderer sets `runningSessions[sid]=true` → compaction runs (seconds, provider summary request).
2. User sends a message during the compaction → renderer queues it (`enqueuePrompt`) → `agentHost.startTurn(admission:"queue")`.
3. `isBusy(state)` → `isOccupied` → `runtime.isBusy` → Main's `isSessionBusy` = FALSE → the queued turn **starts immediately** instead of waiting.
4. `agent.prompt` → sidecar `assertNotRunning()` → `getStatus().isRunning` TRUE → **throws AGENT_BUSY**.
5. The queue entry fails and is consumed (message lost), or a direct send in the `compaction_end`-event-to-RPC-resolve window hits the same AGENT_BUSY and `restoreDraftForKey` puts the text back into the composer.

Automatic compactions (threshold/overflow inside a turn) are unaffected: `activeTurns` is already set for those paths. Only the manual `/compact` path has the gap.

## Change (main-side, minimal)

**File: `apps/desktop/electron/main/index.ts`**

1. Add a module-level set next to `activeTurns` (~line 2376):
   ```ts
   const compactingSessions = new Set<string>();
   ```
2. `agentCompact` handler (~line 8459): after the existing `activeTurns` busy check and the launch resolution, register the session before the compaction call, clear it and kick the queue in `finally` (same pattern as `finishTurn`'s `releaseFinalization`):
   ```ts
   compactingSessions.add(req.sessionId);
   try {
     const result = await sidecar.call("agent.compact", launch.sidecarParams);
     logger.app(...);
     return result;
   } finally {
     compactingSessions.delete(req.sessionId);
     if (!quitting) agentHostBridge?.agentHost.kick(req.sessionId);
   }
   ```
3. Extend `isSessionBusy` (~line 9558):
   ```ts
   isSessionBusy: (sessionId) =>
     activeTurns.has(sessionId) ||
     turnFinalizations.has(sessionId) ||
     compactingSessions.has(sessionId),
   ```

### Behavior after the fix

- A message sent during a manual compaction is **queued properly** (`turn.queued`) instead of starting and failing with AGENT_BUSY.
- The `compaction_end` drain (`packages/agent-host/src/agent-host.ts:266`) sees the session as occupied while the compaction RPC is still in flight, so it no longer starts a turn against a busy runtime.
- When the `agent.compact` RPC resolves, `compactingSessions` is cleared and `kick` drains the queue — the queued message is **delivered automatically right after the compaction**, which is the expected UX.
- Failed compactions also clear the guard in `finally`, so the queue still drains.

### Known residual (out of scope)

A send landing in the sub-millisecond window between the renderer's `compaction_end` handler flipping `runningSessions=false` and the RPC resolving can still take the direct path and fail with AGENT_BUSY (error row + draft restored). This window is not reachable by typing speed and self-heals on retry; closing it would require changing the renderer's event-handling semantics.

## Specs / docs

- Add an E2E scenario to `docs/spec/06-delivery/04-e2e-test-plan.md` using the multi-agent-safe semantic format:
  `E2E-QUEUE-prompt-during-manual-compaction-is-queued-and-delivered` — expected: while a manual compaction is in flight, a sent prompt queues; when the compaction completes, the prompt starts without AGENT_BUSY and completes normally.
- Check `docs/spec/03-runtime/02-agent-runtime.md` for manual-compaction busy-state wording; add one line if the manual-compaction occupancy semantics are described there.

## Process (per AGENTS.md)

1. `git fetch origin main` and create a dedicated branch + worktree from current `main`:
   `fix/manual-compaction-queue-busy`
2. Implement, then review the complete diff (no debug logging, no unrelated changes).
3. Validation:
   - `pnpm build:js`
   - `pnpm --filter @pi-desktop/desktop typecheck`
   - `pnpm -r --if-present test` (agent-host queue tests, shared tests)
   - `cargo` untouched — no Rust changes.
4. E2E for the new scenario: expected NOT RUN in this environment (full provider/UI journey); record `E2E: NOT RUN / Suite / Reason / Alternative validation (unit + typecheck + manual repro) / Remaining risk` per spec §15.
5. Commit as `fix(agent): queue prompts sent during a manual compaction` (one logical concern).

## Explicitly not changing

- The occupancy ring showing the last real request's usage (the first reported symptom) — that is by-design behavior; compaction applies to the next request. Verified against real session data (input dropped 139,122 → 15,518 after compaction).
- Renderer event-handling semantics (`compaction_end` handler).
- agent-host module internals (the fix is the Main-side busy wiring the module already supports via `RuntimePort.isBusy`).