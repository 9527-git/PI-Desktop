/**
 * Real React/Chromium fixture for the entry-less running turn (ADR 0264): the
 * card opens on the turn's own activity even when the transcript's tail lends
 * no entry, the overview then draws the phase and the clock alone, and a turn
 * with neither an entry nor an activity still stands down.
 */
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en } from "@pi-desktop/i18n";
import type { AgentActivity } from "@pi-desktop/shared";
import { TurnProgressCard } from "../../apps/desktop/src/features/chat/transcript/TurnProgressCard";

declare global {
  var turnProgressOpenTurnProbe: () => Promise<unknown>;
}

const assert = (value: unknown, message: string): void => {
  if (!value) throw new Error(message);
};

const pill = (document: Document) =>
  document.querySelector<HTMLElement>('[data-testid="turn-progress-card"]');

globalThis.turnProgressOpenTurnProbe = async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (activity?: AgentActivity) => {
    flushSync(() => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <TurnProgressCard entry={null} activity={activity} hidden={false} />
        </I18nextProvider>,
      );
    });
  };
  try {
    render({ phase: "waiting-model", since: Date.now() - 3000 });
    const card = pill(document);
    assert(card, "an activity-only running turn must still render the card");
    assert(card.hidden === false, "the card must stand open on a live activity");
    card
      .querySelector<HTMLElement>(".turn-progress-head")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const popup = document.querySelector<HTMLElement>(".turn-progress-popup");
    assert(popup, "an entry-less running turn must still pop the overview");
    assert(
      popup.querySelector(".turn-progress-headline"),
      "the overview must carry the phase and the clock without an entry",
    );
    assert(
      !popup.querySelector(".turn-progress-steps"),
      "the overview must not draw step rows without a list",
    );
    assert(
      !popup.querySelector(".turn-progress-foot"),
      "the overview must not draw its footer without steps",
    );
    assert(
      !/Step \d+ \/ \d+/.test(popup.textContent ?? ""),
      "the overview must not invent a step count",
    );

    // A turn with neither an entry nor an activity still stands down: the
    // transcript's own working indicator covers that moment (ADR 0263).
    render(undefined);
    assert(
      pill(document)?.hidden === true,
      "no activity and no rows must stand the card down",
    );
    return { ok: true };
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
};
