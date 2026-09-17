/**
 * The retrying row's error detail: a hover/focus-only tooltip on the body
 * layer. The transcript scroller clipped the old absolutely positioned card
 * once the row sat at the top of a short conversation, and the in-flow error
 * card's translucent tint let the transcript read through the copy.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { AgentActivityError } from "@pi-desktop/shared";
import { IconCircleAlert } from "../../../components/icons";
import {
  placeAnchoredPopover,
  type AnchoredPopoverPlacement,
} from "../../../lib/anchored-popover-position";

export function RetryErrorPopover({
  label,
  error,
}: {
  /** Localized row label, already carrying the retry delay and attempt. */
  label: string;
  /** Bounded provider diagnostics captured with the failed attempt. */
  error: AgentActivityError;
}) {
  const { t } = useTranslation();
  const detailsId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] =
    useState<AnchoredPopoverPlacement | null>(null);
  const summaryKey = `errors.${error.code}`;
  const localizedSummary = t(summaryKey);
  const summary =
    localizedSummary === summaryKey ? t("chat.responseFailed") : localizedSummary;
  const description = `${label}: ${summary}: ${error.message}`;

  const updatePlacement = useCallback(() => {
    const anchor = anchorRef.current;
    const card = cardRef.current;
    if (!anchor || !card) return;
    const anchorRect = anchor.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    // Clamp against the conversation pane rather than the viewport: the pane
    // ends where the work panel begins, and the panel's native browser/plugin
    // surfaces composite above every renderer layer (#246).
    const paneRect = anchor.closest(".main-pane")?.getBoundingClientRect();
    const next = placeAnchoredPopover({
      anchor: {
        left: anchorRect.left,
        top: anchorRect.top,
        bottom: anchorRect.bottom,
      },
      popover: { width: cardRect.width, height: cardRect.height },
      pane: paneRect ? { left: paneRect.left, right: paneRect.right } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    setPlacement((previous) =>
      previous?.top === next?.top &&
      previous?.left === next?.left &&
      previous?.maxWidth === next?.maxWidth
        ? previous
        : next,
    );
  }, []);

  useEffect(() => {
    if (!open) setPlacement(null);
  }, [open]);

  // `is-open` is what reveals the portaled card, so waiting for the first
  // placement keeps an unmeasured card from flashing at the viewport origin.
  useLayoutEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(updatePlacement);
    return () => window.cancelAnimationFrame(frame);
  }, [error.message, open, summary, updatePlacement]);

  useEffect(() => {
    if (!open) return;
    const handleViewportChange = () => updatePlacement();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updatePlacement]);

  useEffect(() => {
    if (!open || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updatePlacement);
    if (cardRef.current) observer.observe(cardRef.current);
    // Sidebar toggle/resize, work-panel open/resize, and the panel's entrance
    // animation move the pane edge without a window resize or a scroll event,
    // so a stale clamp has to be corrected from the pane's own box (#246).
    const pane = anchorRef.current?.closest(".main-pane");
    if (pane) observer.observe(pane);
    return () => observer.disconnect();
  }, [open, updatePlacement]);

  return (
    <>
      <span
        ref={anchorRef}
        className="run-activity-retry-reason"
        tabIndex={0}
        aria-describedby={detailsId}
        aria-label={description}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <span className="working-indicator-label">{label}</span>
      </span>
      {open
        ? createPortal(
            <div
              ref={cardRef}
              id={detailsId}
              className={`run-activity-error-popover message-error${placement ? " is-open" : ""}`}
              role="tooltip"
              style={
                placement
                  ? {
                      top: `${placement.top}px`,
                      left: `${placement.left}px`,
                      maxWidth: `${placement.maxWidth}px`,
                    }
                  : undefined
              }
            >
              <span className="message-error-heading">
                <span className="message-error-icon" aria-hidden>
                  <IconCircleAlert size={16} />
                </span>
                <span className="message-error-copy">
                  <strong>{summary}</strong>
                  <code>
                    {error.code}
                    {error.providerStatus !== undefined
                      ? ` · HTTP ${error.providerStatus}`
                      : ""}
                  </code>
                </span>
              </span>
              <span className="run-activity-error-message selectable">
                {error.message}
              </span>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
