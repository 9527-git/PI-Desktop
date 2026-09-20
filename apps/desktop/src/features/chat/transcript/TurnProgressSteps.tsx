import type {
  TurnProgressStatus,
  TurnProgressStep,
} from "../../../lib/turn-progress";
import { IconCheck, IconCircleAlert } from "../../../components/icons";
import type { Translate } from "./ActivityGroup";

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
        <IconCheck size={11} />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="turn-progress-step-marker is-error" aria-hidden="true">
        <IconCircleAlert size={11} />
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
 * The step overview the popup carries (ADR 0261): one row per step with its
 * state marker, the fold line for steps the window already scrolled past, and
 * a visually-hidden state word per row, since a colored glyph alone is not a
 * readable status. No per-file change figures live here — the overview names
 * the plan, it does not audit the diff.
 */
export function TurnProgressSteps({
  steps,
  earlierSteps,
  t,
}: {
  steps: TurnProgressStep[];
  earlierSteps: number;
  t: Translate;
}) {
  return (
    <ul className="turn-progress-steps">
      {earlierSteps > 0 ? (
        <li className="turn-progress-earlier">
          {t("chat.turnProgressEarlier", {
            count: earlierSteps,
            defaultValue: "…{{count}} earlier",
          })}
        </li>
      ) : null}
      {steps.map((step) => (
        <li key={step.id} data-status={step.status}>
          <StepMarker status={step.status} />
          <span className="turn-progress-step-label">{step.label || "—"}</span>
          <span className="turn-progress-sr">
            {t(STEP_STATUS_KEYS[step.status])}
          </span>
        </li>
      ))}
    </ul>
  );
}
