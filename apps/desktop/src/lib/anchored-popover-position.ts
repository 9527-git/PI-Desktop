/**
 * Placement for body-portaled anchored popovers.
 *
 * Consumers: the composer's context-usage popover (D357) and the transcript's
 * retry-reason tooltip. Both portal to `document.body`, positioned in viewport
 * coordinates, and float above pane stacking (`z-command-palette`). None of
 * that protects them from the work panel: the panel's embedded browser and
 * plugin views are native `WebContentsView`s that composite above every
 * renderer layer, so whatever part of a popover crosses the pane's right edge
 * is covered no matter which `z-index` the popover carries.
 *
 * The clamp therefore uses the conversation pane — which ends exactly where the
 * panel begins — instead of the viewport, and reports the widest box the pane
 * can still afford so a narrow pane cannot push the popover under the panel
 * either.
 */

export const ANCHORED_POPOVER_MARGIN = 16;
export const ANCHORED_POPOVER_GAP = 8;

/** The anchor's viewport rect; only the edges placement reads are required. */
export type AnchoredPopoverAnchor = {
  left: number;
  top: number;
  bottom: number;
};

/** Horizontal extent of the box the popover has to stay inside. */
export type AnchoredPopoverPane = {
  left: number;
  right: number;
};

export type AnchoredPopoverPlacement = {
  top: number;
  left: number;
  /** Caps the popover's own `width` so a narrow pane cannot overflow. */
  maxWidth: number;
};

/**
 * Place the popover above the anchor when it fits, below it otherwise, and
 * inside `pane` on the horizontal axis. Returns `null` when the pane has no
 * usable width, which the caller treats as "leave the popover hidden".
 */
export function placeAnchoredPopover({
  anchor,
  popover,
  pane,
  viewport,
  margin = ANCHORED_POPOVER_MARGIN,
  gap = ANCHORED_POPOVER_GAP,
}: {
  anchor: AnchoredPopoverAnchor;
  popover: { width: number; height: number };
  /** The conversation pane; `null` falls back to the viewport. */
  pane: AnchoredPopoverPane | null;
  viewport: { width: number; height: number };
  margin?: number;
  gap?: number;
}): AnchoredPopoverPlacement | null {
  const left = (pane ? pane.left : 0) + margin;
  const right = (pane ? pane.right : viewport.width) - margin;
  const maxWidth = Math.floor(right - left);
  if (maxWidth <= 0) return null;

  // A pane narrower than the popover caps the popover rather than letting it
  // run under the panel; the widest placement still ends at the pane's edge.
  const width = Math.min(popover.width, maxWidth);
  const maximumLeft = Math.max(left, right - width);
  const clampedLeft = Math.min(Math.max(left, anchor.left), maximumLeft);

  const above = anchor.top - popover.height - gap;
  const below = anchor.bottom + gap;
  const maximumTop = Math.max(
    margin,
    viewport.height - popover.height - margin,
  );
  const top =
    above >= margin && above <= maximumTop
      ? above
      : below >= margin && below <= maximumTop
        ? below
        : Math.min(Math.max(margin, below), maximumTop);

  return { top, left: clampedLeft, maxWidth };
}
