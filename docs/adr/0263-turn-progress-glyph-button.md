# ADR 0263: Wear the turn's progress card as a glyph button, and stand the jump control on the right

- Status: Accepted
- Date: 2026-09-20
- Amends: ADR 0261 (presentation clauses: the labeled pill, its caret, its own chrome, jump-to-latest's centered placement, and the popup's `min(46vh, 360px)` bound)

## Context

ADR 0261 gave the running turn's task list a labeled pill floating at the top of
the thread area, with a caret to pop the step overview. The report was that the
card is gone, and it was right in a way nobody had checked:

- **The pill was never on screen.** `.turn-progress-card` was positioned at
  `top: 12px` inside `.thread-wrap`, but `.thread-wrap` is the first in-flow
  child of `.main-pane`, while `.conversation-topbar` is absolutely positioned
  over that same pane at `top: 0`, `height: var(--ds-toolbar-height)` (46px),
  `z-index: 10`, with an opaque `--ds-bg-primary` fill. The card's `z-index: 5`
  put it *behind* the topbar band, and the band is `-webkit-app-region: drag`,
  so the pill was neither visible nor clickable. Every other overlay in that
  pane already treats the band as occupied: `.thread-content` pads its first row
  down by `--ds-toolbar-height` and `.minimap-rail` starts below it. ADR 0261
  moved the card to the top and out of the pane's paintable area in the same
  step, and no shipped test could see it — the real-render fixture stubs every
  stylesheet out.
- **A labeled bar competes with the messages it reports on.** The ask was a
  small floating button with three dots — the jump control's twin — instead of
  a text-bearing strip in the middle of the reading column.
- **Two centered floaters share one axis.** The jump control sat dead center at
  the bottom of the pane; the ask was to stand it on the right.

The overview also needed to read as an overview — larger type, looser lines, and
a hard guarantee that it never covers the newest messages — where ADR 0261's
`min(46vh, 360px)` was a share of the *window*, not of the room the card has.

## Decision

1. **The card draws below the topbar band.** `.turn-progress-card` pads its
   content by `calc(var(--ds-toolbar-height) + 12px)` on top, so the button and
   its overview start under the band instead of inside it. Any future overlay
   placed in `.thread-wrap` inherits the same obligation; the ADR that moves one
   there must say so.
2. **One floating button, worn twice.** The thread's chrome owns a shared
   `.thread-float-btn` rule in `chat-shell.css` — the same 32×32 round, raised,
   shadow-lifted box with the same hover fill as `.jump-latest-btn` — and both
   controls wear it. Each surface keeps its own placement and entry animation,
   so the two can never drift apart, and the shared rule's `pointer-events:
   auto` is what keeps the glyph clickable inside the card's click-through
   layer.
3. **The progress card is a glyph button.** `TurnProgressCard` renders a
   `TooltipButton` carrying `IconMore` and nothing else: no phase text, no
   clock, no active-step label, no caret. Its label is the existing
   `chat.turnProgressShowSteps` string, it keeps `aria-expanded` and
   `aria-controls`, and it stays collapsed until clicked. The phase, the clock,
   and the step in flight move into the overview, where they are read.
4. **The button always opens the overview.** A turn can be running with no
   declared list and no tool row yet; the overview still has the phase and the
   clock to show, so the click is never a no-op. The step list and the
   `done / total` footer render only when there are steps.
5. **The phase stays spoken, and only the phase.** The card keeps a visually
   hidden `role="status" aria-live="polite"` line whose text follows
   `activity.phase` and is captured when the phase changes — never the ticking
   clock, and never the retry countdown that `runActivityLabel` embeds in the
   `retrying` label. The overview's head draws the same phase (marked
   `aria-hidden`, since the live region already carries it) and the clock beside
   it. ADR 0175's runtime activity row is unchanged.
6. **Reading the overview holds it open.** The five seconds start when the
   pointer and the focus are outside the card, so the timer pauses on
   `pointerenter`/`focus` and resumes on `pointerleave`/`blur`. A right-to-glance
   surface that vanishes under the pointer fails the user who is reading it.
7. **The card is a layer, not a bar.** `.turn-progress-card` is an `inset: 0`
   layer over the thread area that centers its two children and takes no clicks
   of its own. That is what makes the popup's bound honest:
   `max-height: min(46vh, 360px, max(140px, calc(100% - 78px)))`, where `100%` is
   the layer's own content box, the button and the gap take 38px of it, and the
   remainder leaves a message row and the reading gap free above the newest
   messages. Beyond that the overview scrolls inside itself.
8. **The overview is set to be read.** Steps and head use `--text-base-plus`
   with `--leading-prose`, a 10px row gap, 18px markers, and titles that wrap
   instead of truncating; the `done / total` footer uses `--text-base`. Change
   figures stay out of the surface (ADR 0261 §2), no percentage exists, and the
   Composer keeps abort.
9. **Jump-to-latest moves right, and only there.** `.thread-wrap >
   .jump-latest-btn` overrides the centered placement with the reading column's
   right edge — `right: max(24px, calc((100% - var(--chat-content-max-width)) /
   2 + 8px))` — and drops the `translate`. The shared class itself keeps
   centering, so the delegation card's follow control and the work panel's keep
   the placement they had; they belong to their own surfaces.

## Consequences

- The progress surface is visible for the first time since ADR 0261. The band
  the card now clears is the same one the transcript's first row already clears,
  so the message area reads as before.
- The thread's live progress surface is one 32px glyph. What a glance loses, the
  overview returns on one click, and the phase is still spoken; a turn with no
  activity and no rows still shows no button at all.
- The clock costs nothing while the overview is closed: the one-second interval
  runs only while the popup is open.
- `pnpm lint` is green again. ADR 0261 shipped a raw `border-radius: 999px` and
  a raw `line-height: 1.7`, which `scripts/check-style-tokens.mjs` rejects; the
  round shape now comes from `--radius-round` and the leading from the token
  scale, and `turn-progress-surface.test.mjs` pins both literals away.
- Neither floater is centered any more: the top one is centered horizontally by
  its layer, the bottom one sits on the reading column's right edge. The two
  never stack, and the delegation card and work panel are untouched.
- The popup's height depends on the layer's height rather than on the viewport
  alone, and the `max()` floor keeps the arithmetic valid on a pane too short to
  honor it — bounded at 140px rather than falling through to `none`.
- Renderer, styles, tests, and docs only: no IPC channel, schema, migration,
  permission, or persisted-state change.

## Alternatives

### Keep the labeled pill and only restyle it

Rejected. The report was about the labeled bar itself — a text-bearing strip in
the middle of the reading column — not about its paint. The user asked for the
jump control's twin, which is a glyph.

### Keep the card at `top: 12px` and raise its `z-index` above the topbar

Rejected. The band is the window's drag region and the topbar's own surface; an
overlay painted over it would sit on the window controls' row and steal drags.
The pane's established answer is to draw below the band, as the transcript's
first row and the minimap rail already do.

### Suppress the click, or hide the button, when no list is declared

Rejected. The overview is not only the list: it carries the phase and the clock,
which is exactly what a turn with no rows yet has to say. A control that is
present and dead is worse than one that always answers.

### Move the jump control with a modifier class on the transcript's instance

Rejected. A new class would have to be threaded through `ChatTranscript` and
asserted in the transcript contracts, and every consumer of `.jump-latest-btn`
would still carry the old placement. Scoping the override to
`.thread-wrap > .jump-latest-btn` moves exactly one control and leaves the other
two surfaces' markup and tests untouched.

### Keep the popup's `min(46vh, 360px)` bound

Rejected. `46vh` is a share of the window; the thread area is shorter than that
once the topbar, the composer, and their padding are subtracted, so a short pane
let the overview reach the newest rows. Bounding it against the layer's own
height, with a message row of slack, is the only version that cannot.

### Add a looser leading token

Rejected. The scale already tops out at `--leading-prose`; the looseness the
report asks for is delivered by the row gap, the larger type, and wrapping
titles. Inventing a token to preserve an illegal literal would grow the design
system to keep a bug.

### Move the phase and the clock into a tooltip

Rejected. A tooltip is transient, hover-only, and unreachable by touch; the
overview is already the place the reader goes for the list, and a second
transient surface for the same facts would be the drift this ADR avoids.

## References

- `docs/adr/0260-declared-task-progress-card.md`
- `docs/adr/0261-turn-progress-pill.md`
- `docs/adr/0175-live-agent-activity-status.md`
- `docs/spec/04-ux/08-component-spec.md`
- `docs/spec/04-ux/09-interaction-patterns.md` §2.4
- `docs/spec/06-delivery/04-e2e-test-plan.md`
  (`E2E-PROGRESS-declared-task-list-card`)
- `apps/desktop/src/features/chat/transcript/TurnProgressCard.tsx`
- `apps/desktop/src/styles/turn-progress.css`, `apps/desktop/src/styles/chat-shell.css`
