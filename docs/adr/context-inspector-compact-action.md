# ADR: Compact the context from the usage inspector card

- Status: Accepted for implementation
- Date: 2026-09-17
- Deciders: PI-Desktop renderer and UX maintainers
- Amends: [ADR 0103](0103-compact-context-usage-summary.md), [ADR 0106](0106-core-five-builtin-commands.md)
- Related: ADR 0047, D225, D244, D433

## Context

Context compaction could only be started from `/compact`
(`builtin.agent.compact`) or the command palette. The context usage inspector —
the surface that shows how full the model context is — was read-only, so the
moment a user saw the context filling up was also the moment they had to
remember a slash command.

## Decision

The inspector popover card is both the entry point and the result surface.

1. A bottom action row (muted hint left, `Compact context` button right,
   separated by a hairline) starts a manual compaction by calling the existing
   store action `compactContext()` and the existing `agent.compact` IPC.
2. The busy state is derived, not stored: the button is disabled with a spinner
   and the busy label while
   `agentStatuses[activeSessionId].activity?.phase === "compacting"`, which the
   runtime already emits for both manual and automatic compactions.
3. The action is blocked while a live turn owns the composer
   (`controlsBlocked || runActive`), because compaction is a turn-boundary
   operation that the store action refuses on a running session.
4. The checkpoint line gains a persistent "before this compaction" figure.
   `ContextCompactionMark` gains optional `tokensBefore`, filled from the
   durable record's existing `tokensBefore` field, so the figure rides the
   existing `compaction_end` event and the restored `SessionDetail.compactions`
   path with no storage or schema change.
5. No confirmation step: compaction is non-destructive — it installs a
   checkpoint and keeps every message in the transcript.

## Consequences

- `/compact`, the palette, the toasts, and the transcript divider row are
  unchanged; the card adds a third entry point with the same side effects.
- Marks written by an older runtime lack `tokensBefore` and degrade to the
  single checkpoint line.
- The popover stays open across the action; the busy label, the updated
  checkpoint line, and the "before" line are the in-place feedback.

## Alternatives

- An inline button on the checkpoint line, or a header icon button: rejected in
  design — small hit target and weak affordance respectively.
- A confirmation dialog: rejected — compaction keeps every message, so there is
  no destructive outcome to confirm.
