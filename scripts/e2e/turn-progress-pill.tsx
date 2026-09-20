/**
 * Real React/Chromium fixture for the progress pill (ADR 0261): collapsed
 * pill, click-pops overview, five-second self-dismissal, reopen, and the
 * hidden-pane reset. Geometry and the stylesheet split stay with the contract
 * test; this covers what a timer and a click actually do.
 */
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en } from "@pi-desktop/i18n";
import type { UiMessage } from "@pi-desktop/shared";
import {
  TurnProgressCard,
  TURN_PROGRESS_POPUP_AUTO_HIDE_MS,
} from "../../apps/desktop/src/features/chat/transcript/TurnProgressCard";
import type { AssistantTurnEntry } from "../../apps/desktop/src/lib/assistant-turns";

declare global {
  var turnProgressPillProbe: () => Promise<unknown>;
}

const assert = (value: unknown, message: string): void => {
  if (!value) throw new Error(message);
};

const at = "2026-09-19T08:00:00.000Z";
const message = (
  id: string,
  extra: Partial<UiMessage> = {},
): UiMessage => ({ id, role: "tool", content: "", createdAt: at, ...extra });

/** One declaration, in the newest-declaration shape the card reads. */
const entry: AssistantTurnEntry = {
  kind: "assistant-turn",
  id: "turn-1",
  parts: [],
  taskDeclarations: [
    message("declare-1", {
      toolName: "UpdateTasks",
      toolStatus: "success",
      toolArgs: {
        tasks: [
          { title: "读取 transcript 组件", status: "completed" },
          { title: "实现进度按钮", status: "in_progress" },
          { title: "同步规格文档", status: "pending" },
        ],
      },
    }),
  ],
};

const pill = (document: Document) =>
  document.querySelector<HTMLElement>('[data-testid="turn-progress-card"]');
const popup = (document: Document) =>
  document.querySelector<HTMLElement>(".turn-progress-popup");
/** A macrotask, then a frame: enough for React to land its own update. */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
};

globalThis.turnProgressPillProbe = async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (hidden: boolean) => {
    flushSync(() => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <TurnProgressCard entry={entry} hidden={hidden} />
        </I18nextProvider>,
      );
    });
  };
  const getHead = () => {
    const head = pill(document)?.querySelector<HTMLElement>(".turn-progress-head");
    assert(head, "pill did not render");
    return head;
  };
  const clickHead = () => {
    const head = getHead();
    flushSync(() => head.click());
    return head;
  };

  try {
    render(false);
    const head = getHead();
    assert(
      !popup(document),
      "the overview must start collapsed, not lie over the messages",
    );
    assert(
      head.getAttribute("aria-expanded") === "false",
      "the pill must start collapsed",
    );

    clickHead();
    const opened = popup(document);
    assert(opened, "clicking the pill did not pop the overview");
    const openedText = opened?.textContent ?? "";
    for (const label of ["读取 transcript 组件", "实现进度按钮", "同步规格文档"]) {
      assert(openedText.includes(label), `overview lost step "${label}"`);
    }
    assert(openedText.includes("Step 1 / 3"), `overview lost its count: ${openedText}`);
    // Overview, not details: the review surfaces own change figures.
    assert(
      !/\+\d|-\d|files changed/i.test(openedText),
      `overview leaked change figures: ${openedText}`,
    );
    assert(
      head.getAttribute("aria-expanded") === "true",
      "the pill must be expanded after clicking",
    );

    await new Promise((resolve) =>
      setTimeout(resolve, TURN_PROGRESS_POPUP_AUTO_HIDE_MS + 900),
    );
    await settle();
    assert(
      !popup(document),
      "the overview did not dismiss itself inside its five-second budget",
    );
    assert(pill(document), "the pill left with its own overview");

    clickHead();
    render(true);
    await settle();
    assert(!popup(document), "a hidden pane kept an open overview");

    render(true);
    assert(!popup(document), "a hidden pane kept an open overview");
    return { ok: true };
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
};
