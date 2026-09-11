# ADR 0224: Keep the Docked Conversation Composer in Normal Flow

- Status: Accepted for implementation
- Date: 2026-09-11
- Deciders: PI-Desktop core
- Related: ADR 0065, ADR 0137, D264, D372

## Context

Thread mode rendered the composer as an absolute bottom overlay. The transcript
reserved its measured height through a document-level composer-dock-height
property published from a passive effect and a ResizeObserver. That arrangement
allowed a first frame to use a stale value, coupled four CSS consumers to
different fallback values, and let reply content visibly pass under the
transparent dock whenever the reserve lagged or a user scrolled.

The empty-home composer already uses normal flex flow. Thread mode has the same
parent order: the retained session panes render before the Composer.

## Decision

The thread-mode composer is a normal-flow flex sibling after the session panes.
The docked composer uses position: relative and flex: 0 0 auto; thread content
keeps only a 16px reading gap. The thread viewport, jump-to-latest control,
minimap, and settle veil all end above the composer. Composer height changes
therefore reflow the transcript viewport in the same layout pass.

The renderer no longer publishes composer-dock-height; the editor's own height
measurement remains because it controls the editable draft's seven-line cap and
internal scrolling.

## Consequences

- Reply content cannot be painted underneath the composer, including on first
  paint and while queue, ask, approval, or multi-line draft content grows.
- The transcript no longer performs a document-wide style invalidation for dock
  height publication, and the jump/minimap/settle geometry has one containing
  block instead of several height fallbacks.
- The composer remains visually elevated through its existing shell surface,
  shadow, and spacing; only its placement model changes.
- ADR 0065 clause 4 and the composer-height publication portion of D264 are
  superseded.

## Alternatives considered

### Keep the absolute overlay and harden measurement

Rejected because passive-effect publication remains stale on first paint and a
document-level custom property keeps the transcript and its controls coupled to
multiple fallback values.

### Add a permanent overlay veil

Rejected because it hides the overlap rather than removing it, and it reduces the
visible reading area while the composer is already an in-flow sibling.
