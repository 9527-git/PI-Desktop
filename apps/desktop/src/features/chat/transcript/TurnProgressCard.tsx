import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentActivity } from "@pi-desktop/shared";
import type { AssistantTurnEntry } from "../../../lib/assistant-turns";
import { formatToolDuration } from "../../../lib/tool-display";
import {
  turnProgress,
  type TurnProgressStatus,
} from "../../../lib/turn-progress";
import {
  IconArrowDown,
  IconCheck,
  IconChevronRight,
  IconCircleAlert,
} from "../../../components/icons";
import { runActivityLabel, type Translate } from "./ActivityGroup";

const STEP_STATUS_KEYS: Record<TurnProgressStatus, string> = {
  pending: "chat.turnProgressStepPending",
  active: "chat.turnProgressStepActive",
  done: "chat.turnProgressStepDone",
  error: "chat.turnProgressStepError",
};

function StepMarker({ status }: { status: TurnProgressStatus }) {
  if (status === "done") {
    return (
      <span className="turn-progress-step-marker is-done" aria-hidden="true">
        <IconCheck size={10} />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="turn-progress-step-marker is-error" aria-hidden="true">
        <IconCircleAlert size={10} />
      </span>
    );
  }
  return (
    <span
      className={`turn-progress-step-marker is-${status}`}
      aria-hidden="true"
    />
  );
}

/**
 * The running turn's task list, docked over the transcript for the whole turn.
 *
 * The list is the agent's own declaration when it made one (ADR 0260), which is
 * the only source that knows the denominator, and the turn's tool rows when it
 * did not, which is the evidence the transcript already shows. Either way the
 * card is a reading surface, not a control: it reports progress and carries the
 * return-to-latest affordance, and it never stops the turn — Stop lives in the
 * Composer, where the user is already typing.
 */
export function TurnProgressCard({
  entry,
  activity,
  hidden,
  showReturn,
  onReturnToLatest,
}: {
  entry: AssistantTurnEntry | null;
  activity?: AgentActivity;
  /** Keeps the card mounted across scroll and expansion so state survives. */
  hidden: boolean;
  /** Only off-tail does the card own the jump-to-latest control. */
  showReturn: boolean;
  onReturnToLatest: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (hidden) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hidden]);

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
        aria-label={t(
          "chat.turnProgressShowSteps",
          "Show this turn's steps",
        )}
        onClick={() => setOpen((value) => !value)}
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
        <ul className="turn-progress-steps">
          {progress?.earlierSteps ? (
            <li className="turn-progress-earlier">
              {t("chat.turnProgressEarlier", {
                count: progress.earlierSteps,
                defaultValue: "…{{count}} earlier",
              })}
            </li>
          ) : null}
          {progress?.visible.map((step) => (
            <li key={step.id} data-status={step.status}>
              <StepMarker status={step.status} />
              <span className="turn-progress-step-label">
                {step.label || "—"}
              </span>
              <span className="turn-progress-sr">{t(STEP_STATUS_KEYS[step.status])}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {steps > 0 ? (
        <div className="turn-progress-foot">
          <span className="turn-progress-count">
            {t("chat.turnProgressSteps", {
              done: progress?.completed ?? 0,
              total: steps,
              defaultValue: "Step {{done}} / {{total}}",
            })}
          </span>
          {progress && progress.filesChanged > 0 ? (
            <span className="turn-progress-changes">
              <span aria-hidden="true">{" · "}</span>
              {t("panel.review.filesChanged", {
                count: progress.filesChanged,
              })}
              <span className="turn-progress-additions">
                +{progress.additions}
              </span>
              <span className="turn-progress-deletions">
                -{progress.deletions}
              </span>
            </span>
          ) : null}
          {showReturn ? (
            <button
              type="button"
              className="turn-progress-jump"
              title={t("chat.scrollToBottom")}
              aria-label={t("chat.scrollToBottom")}
              onClick={onReturnToLatest}
            >
              <IconArrowDown size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
