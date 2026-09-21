# ADR 0264: Keep the progress card on the running turn, not on its tail

- Status: Accepted
- Date: 2026-09-20
- Amends: ADR 0263 (the gate clause: the card stands on the running turn itself)

## Context

ADR 0263 made the progress card visible for the first time — it moved the button
below the topbar band — and gave it a glyph. The report came back the same way
anyhow: while a turn is running, there is nothing above the messages.

The cause was the gate, not the paint. `ChatTranscript` mounted the card only
when the transcript's tail entry happened to be an `assistant-turn`:

    const progressTurnEntry =
      transcriptRunning && ... && tailEntry?.kind === "assistant-turn"
        ? tailEntry : null;

The tail frequently is not that entry while the turn is running.
`buildTranscriptEntries` closes the assistant turn and appends a
`{ kind: "compaction" }` divider when a compaction mark anchors to the last
message, so during and after a compaction the tail is a divider. A turn that
has just started — or one whose only output so far is the user's own row —
leaves a `{ kind: "message" }` tail. In both shapes `progressTurnEntry` was
`null`, so `TurnProgressCard` was never mounted even though the runtime was
streaming an activity and the card's own overview had the phase and the clock
to show.

ADR 0263 had already written the intent: "a turn with no activity and no rows
still shows no button at all" — which implies the converse, that a turn *with*
an activity shows one. Component-spec §4 likewise promised a button "for the
whole turn". The implementation was stricter than both, and no test could see
it: the fixtures passed an entry by construction.

## Decision

1. **The running turn opens the card.** The gate is the turn, not the tail:
   `transcriptRunning && !pendingPermission && !askPending && !approvalPending`.
   While that holds, `TurnProgressCard` stays mounted and `hidden` follows pane
   visibility and the settle veil alone.
2. **The tail only lends steps.** `entry` is passed through when the tail entry
   is the turn's own `assistant-turn`, and `null` otherwise — a user row, a
   compaction divider, or an entry-less tail must not lend the card the previous
   turn's steps. With `entry` null the overview draws its head — the phase and
   the clock — and nothing else.
3. **An empty card is the only silent one.** Inside the component
   `isEmpty = steps === 0 && !activity`: no activity and no rows is the one
   state the transcript's own working indicator covers. The clock starts from
   `progress.startedAt ?? activity.since ?? now`, so an entry-less turn times
   from the phase's own start instead of resetting on every render.
4. **The gate is its own module.** `turn-progress-gate.ts` holds the rule and
   returns `{ open, entry, onScreen }`; `ChatTranscript` keeps only the wiring,
   and the rule is testable without rendering. ADR 0260's no-store rule still
   holds — the module reads nothing but its arguments.
5. **The overview moves out.** `TurnProgressOverview.tsx` owns the popup's
   markup so the card stays inside the file-length budget, and the overview
   draws its step rows and `done / total` footer only when the turn has steps.

## Consequences

- The glyph button is on screen for the whole turn: from the moment the runtime
  reports an activity to the moment the turn ends, whatever the transcript's
  tail happens to be. The step list still appears the instant the turn declares
  one or runs a tool.
- A turn with no entry shows the phase and the clock; a turn that never reports
  an activity and never produces a row still shows nothing, and the transcript's
  working indicator covers that moment.
- `turn-progress-gate.test.mjs` covers the rule directly, the Chromium fixture
  `turn-progress-open-turn.tsx` covers the entry-less card end to end, and the
  surface contract pins the wiring and the empty-card clause.
- Renderer only: no IPC channel, schema, migration, permission, or
  persisted-state change.

## Alternatives

### Keep the tail-entry gate and special-case the compaction divider

Rejected. The divider is only one way the tail stops being the turn's entry; a
just-started turn has the same shape, and the transcript's tail is a moving
target the card does not own. "A turn is running" is the fact the card actually
speaks for.

### Hand the card the previous assistant turn when the tail is not one

Rejected. The steps would be the previous turn's, and the card would claim work
the running turn has not done. An honest head with the phase and the clock is
better than a wrong list.

### Render the card only when it has steps

Rejected. That is the bug restated: the turn's first seconds — which have the
phase and the clock — are exactly when the user looks for the card. ADR 0263 §4
made the same call.

## References

- `docs/adr/0260-declared-task-progress-card.md`
- `docs/adr/0261-turn-progress-pill.md`
- `docs/adr/0263-turn-progress-glyph-button.md`
- `docs/spec/04-ux/08-component-spec.md`
- `docs/spec/04-ux/09-interaction-patterns.md` §2.4
- `docs/spec/06-delivery/04-e2e-test-plan.md`
  (`E2E-PROGRESS-open-turn-phase-and-clock`)
- `apps/desktop/src/features/chat/transcript/turn-progress-gate.ts`
- `apps/desktop/src/features/chat/transcript/TurnProgressCard.tsx`
- `apps/desktop/src/features/chat/transcript/TurnProgressOverview.tsx`
