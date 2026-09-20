import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentActivity } from "@pi-desktop/shared";
import type { AssistantTurnEntry } from "../../../lib/assistant-turns";
import { formatToolDuration } from "../../../lib/tool-display";
import { turnProgress } from "../../../lib/turn-progress";
import { IconChevronRight } from "../../../components/icons";
import { runActivityLabel, type Translate } from "./ActivityGroup";
import { TurnProgressSteps } from "./TurnProgressSteps";

/** The overview is a glance, not a panel: it dismisses itself (ADR 0261). */
export const TURN_PROGRESS_POPUP_AUTO_HIDE_MS = 5000;

/**
 * The running turn's task list, worn as a floating pill centered at the top
 * of the transcript so it never covers the messages it reports on (ADR 0261;
 * the list itself is still ADR 0260's declared-or-observed shape). The pill
 * names the phase, the elapsed time, and the active step; clicking it pops
 * the step overview beneath the pill, and the popup dismisses itself five
 * seconds later instead of lying flat over the composer. It is a reading
 * surface, not a control: cancellation stays in the Composer, and
 * jump-to-latest stays with the transcript's own pill.
 */
export function TurnProgressCard({
  entry,
  activity,
  hidden,
}: {
  entry: AssistantTurnEntry | null;
  activity?: AgentActivity;
  /** Keeps the card mounted across scroll and expansion so state survives. */
  hidden: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const popupId = useId();

  // The 1s timer is the card's own cost, so it stops while the card is hidden.
  useEffect(() => {
    if (hidden) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hidden]);

  // An off-screen pane always comes back to the pill alone.
  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  useEffect(() => {
    if (!open || hidden) return;
    const timer = window.setTimeout(
      () => setOpen(false),
      TURN_PROGRESS_POPUP_AUTO_HIDE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [open, hidden]);

  const progress = turnProgress(entry, now);
  // A turn with neither a declared list nor a single row has nothing for the
  // card to say; the transcript's own working indicator covers that moment.
  const isEmpty = !progress || (progress.steps === 0 && !activity);
  const elapsed = formatToolDuration(
    Math.max(0, Math.floor((now - (progress?.startedAt ?? now)) / 1000)),
  );
  const status = activity
    ? runActivityLabel(activity, t as Translate, now)
    : t("chat.running");
  const steps = progress?.steps ?? 0;

  return (
    <section
      className="turn-progress-card"
      data-testid="turn-progress-card"
      data-phase={activity?.phase}
      data-declared={progress?.declared ? "true" : undefined}
      aria-label={t("chat.turnProgressLabel", "Current task progress")}
      hidden={hidden || isEmpty}
    >
      <button
        type="button"
        className="turn-progress-head"
        aria-expanded={open}
        aria-controls={popupId}
        aria-label={t("chat.turnProgressShowSteps", "Show this turn's steps")}
        onClick={() => setOpen((value) => (steps > 0 ? !value : false))}
      >
        <span className="turn-progress-status" role="status" aria-live="polite">
          <span className="turn-progress-dot" aria-hidden="true" />
          {status}
        </span>
        <span className="turn-progress-metrics" aria-hidden="true">
          {elapsed}
        </span>
        {!open && progress?.activeLabel ? (
          <span className="turn-progress-action">{progress.activeLabel}</span>
        ) : null}
        <span className="turn-progress-caret" aria-hidden="true">
          <IconChevronRight size={12} />
        </span>
      </button>
      {open && steps > 0 ? (
        <div className="turn-progress-popup" id={popupId}>
          <TurnProgressSteps
            steps={progress?.visible ?? []}
            earlierSteps={progress?.earlierSteps ?? 0}
            t={t as Translate}
          />
          <div className="turn-progress-foot">
            <span className="turn-progress-count">
              {t("chat.turnProgressSteps", {
                done: progress?.completed ?? 0,
                total: steps,
                defaultValue: "Step {{done}} / {{total}}",
              })}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
