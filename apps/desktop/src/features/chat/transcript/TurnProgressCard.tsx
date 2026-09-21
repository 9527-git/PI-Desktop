import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentActivity } from "@pi-desktop/shared";
import type { AssistantTurnEntry } from "../../../lib/assistant-turns";
import { formatToolDuration } from "../../../lib/tool-display";
import { turnProgress } from "../../../lib/turn-progress";
import { IconMore } from "../../../components/icons";
import { TooltipButton } from "../../../components/ui";
import { runActivityLabel, type Translate } from "./ActivityGroup";
import { TurnProgressOverview } from "./TurnProgressOverview";

/** The overview is a glance, not a panel: it dismisses itself (ADR 0261). */
export const TURN_PROGRESS_POPUP_AUTO_HIDE_MS = 5000;

/**
 * The running turn's task list (ADR 0260), worn since ADR 0263 as one small
 * floating glyph button below the conversation topbar: the jump control's twin,
 * three dots instead of an arrow, and no text of its own. Clicking it pops the
 * overview beneath it — the phase, the clock, the step in flight, and the step
 * list — which dismisses itself five seconds later, or holds while the pointer
 * or the focus is inside it. The overview is bounded to the room it has, so a
 * long list scrolls inside it instead of growing down over the newest messages.
 * It is a reading surface, not a control: cancellation stays in the Composer,
 * and jump-to-latest stays with the transcript's own button.
 *
 * Since ADR 0264 the card stands on the running turn itself: with no entry and
 * a live activity it still opens, because the phase and the clock are what a
 * turn with no rows yet has to say; with neither, it stands down.
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
  const [held, setHeld] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [spoken, setSpoken] = useState("");
  const popupId = useId();

  // The clock is drawn inside the overview only, so it ticks only while the
  // overview is up: a closed card costs nothing.
  useEffect(() => {
    if (hidden || !open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hidden, open]);

  // An off-screen pane always comes back to the button alone.
  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  // Reading the overview holds it open: the five seconds resume once the
  // pointer and the focus have left it.
  useEffect(() => {
    if (!open || hidden || held) return;
    const timer = window.setTimeout(
      () => setOpen(false),
      TURN_PROGRESS_POPUP_AUTO_HIDE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [open, hidden, held]);

  const progress = turnProgress(entry, now);
  // ADR 0264: the running turn owns the card. With no activity and no rows it
  // has nothing to say — the transcript's own working indicator covers that
  // moment — while a live activity alone still opens it.
  const steps = progress?.steps ?? 0;
  const isEmpty = steps === 0 && !activity;
  const startedAt = progress?.startedAt ?? activity?.since ?? now;
  const elapsed = formatToolDuration(
    Math.max(0, Math.floor((now - startedAt) / 1000)),
  );
  const status = activity
    ? runActivityLabel(activity, t as Translate, now)
    : t("chat.running");
  const phase = activity?.phase ?? "running";

  // The spoken phase follows the phase, never the clock: `retrying` embeds a
  // countdown in its label, and re-announcing that once a second would talk
  // over the transcript.
  useEffect(() => {
    setSpoken(status);
  }, [phase]);

  return (
    <section
      className="turn-progress-card"
      data-testid="turn-progress-card"
      data-phase={activity?.phase}
      data-declared={progress?.declared ? "true" : undefined}
      aria-label={t("chat.turnProgressLabel", "Current task progress")}
      hidden={hidden || isEmpty}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <TooltipButton
        className="thread-float-btn turn-progress-head"
        tooltip={t("chat.turnProgressShowSteps", "Show this turn's steps")}
        ariaLabel={t("chat.turnProgressShowSteps", "Show this turn's steps")}
        aria-expanded={open}
        aria-controls={popupId}
        onClick={() => setOpen((value) => !value)}
      >
        <IconMore size={16} />
      </TooltipButton>
      {/* The button is a glyph, so the phase is spoken from here instead of being
       * drawn on the message surface. */}
      <span className="turn-progress-sr" role="status" aria-live="polite">
        {spoken}
      </span>
      {open ? (
        <TurnProgressOverview
          id={popupId}
          status={status}
          elapsed={elapsed}
          activeLabel={progress?.activeLabel ?? ""}
          progress={progress}
          t={t as Translate}
        />
      ) : null}
    </section>
  );
}
