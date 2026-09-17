# ADR 0259: Send a Queued Row by Steering and Return It to the Composer on Edit

- Status: Accepted for implementation
- Date: 2026-09-17
- Deciders: PI-Desktop core
- Related: ADR 0118, ADR 0213, D212, D253, D375, D386, D430

## Context

ADR 0118 and ADR 0213 clause 4 shipped "send now" as `agent/queue/prioritize`
followed by a graceful stop: the running assistant/tool boundary had to finish
before the promoted prompt could start. A user who wants to redirect a run
therefore waits for the whole boundary, and the queued row's only other action
discarded the message instead of letting the user revise it.

The desktop already has a steering contract (`agent/steer`, `03-runtime/01-ipc-protocol.md`
§5.1a) that injects user input into the running turn at its next
model-request/tool boundary without stopping the provider stream, canceling
running tools, or opening a second durable turn.

## Decision

A queued row's **Send now** steers while the session is running. The renderer
promotes the row to the head of the Host-owned queue (`agent/queue/prioritize`)
and then injects its content through the existing `steerPrompt` path, carrying
the running turn's `expectedTurnId` and the row's prepared attachments. The
row leaves the queue only after the Host accepts the injection. A steer that
races the turn's end (`TURN_NOT_FOUND`) leaves the promoted row to start as the
next turn, ahead of the remaining FIFO rows. An idle session keeps the original
path: promote, and the Host starts the entry.

The steer taken by Send now is quiet: the renderer suppresses only the toasts
that mean "the row stays queued" (steering unavailable, turn no longer found).
Real failures still surface.

A queued row's **×** returns the message instead of discarding it. The row's
captured draft — the prompt text the user wrote plus structured file
references — is handed back through the composer-prefill channel and becomes an
editable composer draft, and the row leaves the Host queue. The edit is refused
with a toast while the live composer already holds text or file references, so
an in-progress draft is never overwritten.

## Consequences

- Send now no longer stops the running turn; the prompt lands at the boundary
  the steering contract already defines.
- No message is lost: the row is removed only after the Host accepts the
  injection, and a rejected steer keeps the promoted row for the next turn.
- `agent/stop` loses its last renderer caller; the channel remains available
  (local MCP control plane `agentStop`) and is not removed.
- Renderer plus catalogs only: no IPC channel, Host RPC, storage schema,
  permission, or persisted-state change. The `chat.removeQueuedPrompt` catalog
  key is replaced by `chat.editQueuedPrompt` and `chat.editQueuedPromptBusy` in
  all eight locales.

## Alternatives considered

### Keep the graceful stop and only fix the edit action

Rejected because it keeps the delay the user reported: the purpose of Send now
is to reach the running task immediately.

### Stop the turn before injecting

Rejected: cancelling the current reply and tools to deliver a follow-up
destroys work the user did not ask to lose, and it contradicts the steering
contract that exists for exactly this case.

### Return the row to the composer without removing it from the queue

Rejected: the prompt would exist twice and could be sent twice.
