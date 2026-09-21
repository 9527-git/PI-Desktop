# ADR 0265: Stand the progress card above the composer

- Status: Accepted
- Date: 2026-09-20
- Amends: ADR 0263 (the placement clause: the card draws below the topbar band)

## Context

ADR 0263 fixed the card's paint — it had been drawn behind the topbar band —
by padding the layer's content below that band. The button then stood at the
top center of the thread area. The report came back the same way as before:
the card is somewhere else than where it is looked for.

The ask is the composer. The progress surface belongs centered directly above
the message box the user is watching, in the same column the messages arrive
in — not pinned under the window's title band — and the overview it pops must
grow upward from there, so neither the button nor the popup can ever come
between the reader and the newest message.

The thread area already ends where the docked composer begins (ADR 0258: the
composer is a normal-flow sibling of the session panes), so bottom-aligning the
card's layer puts the button in that gutter with no arithmetic against the
topbar.

## Decision

1. **The layer is bottom-aligned.** `.turn-progress-card` keeps `inset: 0` and
   adds `justify-content: flex-end` with `padding: 16px 32px 12px`, so the
   button stands 12px above the composer's top edge, horizontally centered on
   the reading column.
2. **The overview pops upward.** The popup keeps its DOM place after the button
   — the button stays the trigger's tab stop — and takes `order: -1` in the
   flex column, with `margin-bottom: 6px` instead of a top margin. Its
   `max-height` formula is unchanged: the composer gap, the button, and the gap
   below the popup take 50px of the content box, and the bound still leaves a
   message row clear at the top.
3. **Both entry animations come from below.** The button rises into place
   (`translate: 0 6px` → `0`) and the popup grows from the button
   (`translate: 0 4px` → `0`), mirroring ADR 0263's downward pair.
4. **Nothing else moves.** The layer's `z-index`, the shared
   `.thread-float-btn` chrome, the jump control's own gate and right-edge
   placement, the five-second dismissal, and the live region are unchanged.

## Consequences

- The button is where it is looked for: centered above the composer, in the
  reading column's own gutter. The topbar band is left to the title and its
  controls.
- The overview grows away from the composer, so a long declared list can never
  push against or cover the message box; the layer's bottom padding is the only
  arithmetic between the two surfaces.
- `turn-progress-styles.test.mjs` pins the new placement, the popup's order,
  and the inverted animations; the Chromium fixtures are unchanged, because
  they stub styles out and cover behavior, not placement.
- Renderer styles only: no markup, IPC, schema, permission, or persisted-state
  change.

## Alternatives

### Keep the top placement and let the user look up

Rejected. The report is explicit, and the composer is the surface the progress
card reports on: the card belongs beside the thing it is about.

### Float the card over the composer's own row

Rejected. The composer is a normal-flow sibling (ADR 0258); overlaying its row
would cover the draft the user is typing. The gutter above it is the one strip
of the thread area that is always free.

### Anchor the card to the window instead of the thread area

Rejected. The card's overview must bound itself against the room the thread
area has, and the transcript's own controls (the jump button, the minimap) are
placed against the thread area; a window-anchored card would drift from the
column it annotates whenever the work panel or sidebar changes width.

## References

- `docs/adr/0258-in-flow-chat-composer.md`
- `docs/adr/0260-declared-task-progress-card.md`
- `docs/adr/0263-turn-progress-glyph-button.md`
- `docs/adr/0264-turn-progress-open-turn.md`
- `docs/spec/04-ux/08-component-spec.md`
- `docs/spec/04-ux/09-interaction-patterns.md` §2.4
- `docs/spec/06-delivery/04-e2e-test-plan.md`
  (`E2E-PROGRESS-open-turn-phase-and-clock`)
- `apps/desktop/src/styles/turn-progress.css`,
  `apps/desktop/src/styles/turn-progress-overview.css`
