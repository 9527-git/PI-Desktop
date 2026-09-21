import type { TurnProgress } from "../../../lib/turn-progress";
import type { Translate } from "./ActivityGroup";
import { TurnProgressSteps } from "./TurnProgressSteps";

/**
 * The overview the glyph button pops (ADR 0263): the phase, the clock, the
 * step in flight, and the step list, set to be read at glance size. It is
 * drawn only while the card is open, and it renders the step rows and the
 * `done / total` footer only when the running turn actually has steps — a turn
 * with no rows yet still gets the head, because the phase and the clock are
 * what it has to say (ADR 0264).
 */
export function TurnProgressOverview({
  id,
  status,
  elapsed,
  activeLabel,
  progress,
  t,
}: {
  id: string;
  status: string;
  elapsed: string;
  activeLabel: string;
  progress: TurnProgress | null;
  t: Translate;
}) {
  const steps = progress?.steps ?? 0;
  return (
    <div className="turn-progress-popup" id={id}>
      {/* The drawn copy of the spoken line: the live region beside this
       * overview already carries the phase, and the clock is not announced. */}
      <p className="turn-progress-headline" aria-hidden="true">
        <span className="turn-progress-status">{status}</span>
        <span className="turn-progress-metrics">{elapsed}</span>
      </p>
      {activeLabel ? (
        <p className="turn-progress-active">{activeLabel}</p>
      ) : null}
      {steps > 0 ? (
        <>
          <TurnProgressSteps
            steps={progress?.visible ?? []}
            earlierSteps={progress?.earlierSteps ?? 0}
            t={t}
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
        </>
      ) : null}
    </div>
  );
}
