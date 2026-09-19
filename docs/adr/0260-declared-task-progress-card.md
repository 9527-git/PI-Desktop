# ADR 0260: Let the agent declare its task list to drive one persistent progress card

- Status: Accepted
- Date: 2026-09-19
- Amends: ADR 0175 (clause: no multi-step progress card); `04-ux/09-interaction-patterns.md` §2.4

## Context

The request was a task card reporting the progress of the turn in flight.
ADR 0175 had already settled how an active turn explains itself — inline
transcript rows plus one compact runtime status row for quiet intervals — and
had rejected "a permanent multi-step progress card", because an agent turn has
no reliable total-step or percentage model. §2.4 of the interaction patterns
made that rejection a contract, enforced by `active-turn-surface.test.mjs`.

The design dialogue first settled the honest form of the card: no denominator,
no percentage, docked over the transcript, expandable to the turn's own step
rows. Implemented that way, the card was reviewed against the shape the user
actually asked for — a checklist with one mark per step and a footer reading
`step 10 / 10 · 26 files changed +897 -48`. A card built on observed rows can
report how many steps happened; it cannot report how many were intended, so it
can never produce that footer honestly. Two decisions followed, and both change
what ADR 0175 forbade rather than working around it:

- The list is **declared by the agent** through a tool, so the denominator is
  the model's own statement and not an inference from row counts.
- The card is **persistent for the running turn**, not gated on scroll state.
  A declared checklist is worth reading while the transcript is in view, and
  tying it to follow mode made it disappear exactly when the user looked for it.

## Decision

1. **A new Agent-mode tool, `UpdateTasks`, carries the declaration.** It is a
   sidecar-local `AgentTool` with its own `execute`, like the other
   runtime-authored tools: it touches no workspace path, asks no permission,
   reaches no host-core code, adds no IPC channel, and changes no schema
   version or persisted column. The list is replaced whole on every call and
   capped at 24 items, because a patch language costs schema the model gets
   wrong and buys nothing at this size. Its result echoes the normalized list in
   `details.tasks`, so a row survives persistence already carrying the
   arguments. It is registered as a **core** tool: a card whose source sits
   behind `ToolSearch` is a card that never fills in.
2. **The declaration is transcript data, not application state.**
   `AssistantTurnEntry` gains `taskDeclarations`, filled by the existing
   `buildTranscriptEntries` pass. A declaration row opens its turn like any tool
   row but is filtered out of `visible` and out of the turn's parts, so it
   becomes neither a second transcript row nor a minimap target with nothing
   mounted behind it; `reuseTranscriptEntries` keeps its identity across a
   rebuild by comparing the declaration list element-wise. No store slice,
   IPC event, or shared type was added, and the store's standing ban on progress
   state stays in force.
3. **One card, on screen for the whole running turn.** Its gate is: the turn is
   running, this entry owns the live tail, no permission/question/approval card
   is up, the pane is visible, and no session-switch veil is settling. The card
   stays mounted and toggles `hidden`, so an expansion survives a round trip.
4. **Its content is the declared list, and the rows when there is none.** The
   head line keeps ADR 0175's phase label (`runActivityLabel`) and elapsed time
   from the turn's own first row. Each step carries a marker — pending, active,
   done, error — and the footer reports `step done / total` plus the files,
   additions, and deletions the turn has already produced, from the same
   `summarizeReviewChanges(reviewChangesFromMessages(...))` the review surface
   uses. When no list was declared, or the newest one cannot be read, the steps
   are the turn's own tool rows, whose status comes from `toolStatus`. A card
   that disappears on a malformed call is worse than one that says less.
   Nothing is estimated, and no percentage exists anywhere.
5. **The card owns the return-to-latest affordance only while it is owed.**
   Off-tail, the footer carries the jump button and the `.jump-latest-btn` pill
   stands down, so the lower surface never shows two controls that both say "you
   are not looking at the live tail". On-tail, the footer shows none and the
   pill keeps its normal behavior for a settled transcript.
6. **It carries no stop control.** The composer owns abort, and one running turn
   must not present two ways to cancel it.

## Consequences

- ADR 0175's blanket "no multi-step progress card" is now bounded: the card it
  rejected was one whose numbers were inferred. An honest denominator exists
  only because the agent supplies it, and the card says so in its own markup
  (`data-declared`), so a declared list and an observed row list are never
  confused for each other.
- The denominator is only as good as the model's compliance. The steering text
  lives in the Agent-mode system prompt, the tool description repeats it, and
  the observed-rows path is a first-class mode rather than an error state, so a
  turn that never calls `UpdateTasks` still gets a card.
- Declaring costs tokens: every call re-sends the whole list and returns it, and
  the cap exists for that reason as much as for readability.
- The lower transcript surface now has a floating layer that is up for the whole
  turn, so it must never overlap the composer, must stay inside the transcript's
  centered content column, and must be clear of the minimap rail — the CSS owns
  that, and the card's list is capped at eight rows so its height is bounded.
- Chat, Plan, and Goal are excluded deliberately: chat answers questions rather
  than working, and Plan/Goal already present their steps as an approved
  contract, so a second list would compete with it.
- `turn-progress*` naming stays. The existing contract test forbids
  `AgentProgress`/`agent-progress` names in the transcript and progress state in
  the store; those assertions remain in force and now also pin the card's gate,
  its pill suppression, the declaration's exclusion from `visible`, and the
  tool's containment inside the sidecar.
- Reduced motion now has progress-card motion — an entry animation, a caret
  rotation, and a spinning active marker — so all three are disabled under that
  preference, which retires §2.4's sentence claiming there was none.

## Alternatives

### Keep the card off-tail-only

Built first, then reversed on direction. It made the card a scroll artifact: it
existed only while the user was looking somewhere else, and a checklist the user
cannot read while working is a notification, not a progress surface.

### Emit a provider-side percentage or estimated total

Rejected with ADR 0175: the runtime has no reliable total-step model, and a
fabricated denominator is the exact failure that rejection names.

### Infer step boundaries and totals from the tool rows

Rejected. Counting rows yields `n so far`, never `n of m`; promoting it to a
denominator would state the model's intent as if the renderer knew it, and would
reach 100% the moment the model stopped calling tools.

### Reuse `SubmitPlan` / the plan artifact as the checklist

Rejected. A plan is an approved contract with a durable `.pi/plan/*.md` artifact
and an approval gate (ADR 0053, ADR 0052); an ordinary multi-step request is not,
and its approval card is an actionable interruption that §2.4 keeps separate from
progress.

### Track the list in the store with a persisted column

Rejected. The declaration already rides the tool call the transcript persists, so
a second copy would need a migration, a schema version, and a reconciliation rule
for the two sources — and would break the identity reuse that keeps long
transcripts cheap to rebuild.

## References

- `docs/adr/0175-live-agent-activity-status.md`
- `docs/adr/0137-retained-session-panes.md`
- `docs/adr/0048-lazy-per-turn-tool-activation.md`
- `docs/spec/04-ux/09-interaction-patterns.md` §2.4
- `docs/spec/03-runtime/03-tools-and-permissions.md` §2, §10.3
- `docs/spec/06-delivery/04-e2e-test-plan.md` (E2E-094,
  `E2E-PROGRESS-declared-task-list-card`)
- GitHub Issue #56
