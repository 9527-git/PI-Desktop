# ADR 0261: Wear the turn's progress card as a pill with a self-dismissing overview

- Status: Accepted
- Date: 2026-09-20
- Amends: ADR 0260 (presentation clauses: one docked full-width card, in-place expansion, card-owned jump control)
- Amended by: ADR 0263 (presentation clauses: the labeled pill and its text head, the caret, the pill's own chrome, and jump-to-latest's centered placement)

## Context

ADR 0260's card docks over the bottom of the transcript for the whole running
turn, one content-column wide, and expands in place toward the composer. In
use it reads as a bar lying on the message surface: it covers the newest rows
while the turn streams, and its expanded state spreads flat above the message
composer, exactly where the user is typing. The report was precise — the task
card blocks the task messages it reports on. The request: shrink the card
into a small floating button centered at the top of the message area, pop the
progress card from it on click instead of expanding in place, let the popup
hide itself after five seconds, and show the task overview — larger type,
looser lines — rather than the turn's change details.

## Decision

1. **The card is a pill, not a bar.** `.turn-progress-card` keeps its layer
   and its gate (ADR 0260 §3) but shrinks to one compact floating button
   centered at the *top* of the thread area. It carries the phase label, the
   elapsed timer, and the active step label — the same head the docked card
   already had — and the positioning layer takes no clicks of its own.
2. **The steps live in a self-dismissing popup.** Clicking the pill pops the
   step overview beneath it as a floating panel; it never lies flat over the
   composer and never pushes layout. The popup closes itself five seconds
   after opening (`TURN_PROGRESS_POPUP_AUTO_HIDE_MS`), closes when the pane
   hides, and reopens on the next click. The popup is overview-only: the
   declared or observed steps with their markers, the fold line for older
   steps, and the `done / total` count, set in a larger type size with looser
   line spacing than the dense transcript rows. The files, additions, and
   deletions figures leave the progress surface — the review cards own change
   numbers, and two surfaces quoting one figure can only drift apart.
3. **Jump-to-latest returns to the transcript's pill.** A top pill cannot own
   a bottom control, so `.jump-latest-btn` renders on its own gate again and
   `TurnProgressCard` loses `showReturn`/`onReturnToLatest`; the two floaters
   sit at opposite ends of the pane and never stack.
4. **The surface gets its own stylesheet and its own steps module.**
   `turn-progress.css` takes every `.turn-progress-*` rule out of
   `chat-shell.css`, and `TurnProgressSteps.tsx` takes the checklist out of
   the card module; the contract test pins both halves of the split.

## Consequences

- ADR 0260's core stands: the declared `UpdateTasks` list is still the only
  honest denominator, the gate (running turn, owns the tail, no actionable
  interruption, visible pane, no settling veil) is unchanged, and the card
  still never shows a percentage, an estimate, or a stop control. What changes
  is only how the surface is worn.
- The collapsed-by-default pill puts the step list one click away instead of
  always expanded; the five-second auto-dismiss keeps a reading glance from
  becoming permanent chrome, and a click brings it straight back.
- `panel.review.filesChanged` leaves the card, so progress and review numbers
  can never disagree — the card stops quoting them.
- `active-turn-surface.test.mjs` keeps the tool and declaration contracts;
  the card's surface contract moves to `turn-progress-surface.test.mjs`.
