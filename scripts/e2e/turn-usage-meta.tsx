import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";
import { en } from "@pi-desktop/i18n";
import type { UiMessage } from "@pi-desktop/shared";
import { AssistantTurn } from "../../apps/desktop/src/features/chat/transcript/AssistantTurn";
import { MessageRow } from "../../apps/desktop/src/features/chat/transcript/MessageRow";
import { buildTranscriptEntries } from "../../apps/desktop/src/lib/assistant-turns";

declare global {
  var turnUsageMetaProbe: () => Promise<unknown>;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const message = (
  id: string,
  role: UiMessage["role"],
  content: string,
  extra: Partial<UiMessage> = {},
): UiMessage => ({ id, role, content, createdAt: extra.createdAt ?? new Date().toISOString(), ...extra });

/** Real React DOM + the D436 meta row: per-turn usage chips and time chips. */
globalThis.turnUsageMetaProbe = async () => {
  try {
    return await runProbe();
  } catch (error) {
    return { ok: false, error: String(error), stack: (error as Error)?.stack };
  }
};

async function runProbe() {
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const renderErrors: unknown[] = [];
  const root = createRoot(container, {
    onUncaughtError: (error) => {
      renderErrors.push(error);
    },
  });
  const render = (node: ReactNode) => {
    flushSync(() =>
      root.render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>),
    );
    assert(
      renderErrors.length === 0,
      `React render failed: ${renderErrors.map(String).join("; ")}`,
    );
  };
  const renderTurn = (messages: UiMessage[], isActive: boolean) => {
    const entry = buildTranscriptEntries(messages).entries.find(
      (item) => item.kind === "assistant-turn",
    );
    assert(entry?.kind === "assistant-turn", "assistant turn missing");
    render(<AssistantTurn entry={entry} isActive={isActive} />);
  };

  const now = new Date().toISOString();
    const user = message("user", "user", "Summarize the workspace", {
      createdAt: now,
    });
    const answer = message("answer", "assistant", "All done.", {
      createdAt: now,
      modelId: "gpt-test",
      responseDurationMs: 1500,
      usage: {
        inputTokens: 12345,
        outputTokens: 678,
        totalTokens: 13023,
        cacheReadTokens: 8900,
        cacheWriteTokens: 120,
      },
    });

    renderTurn([user, answer], false);
    const text = container.textContent ?? "";
    assert(text.includes("gpt-test"), "model chip missing");
    assert(text.includes("Input 12k"), `input chip missing: ${text}`);
    assert(text.includes("Output 678"), `output chip missing: ${text}`);
    assert(text.includes("Cache read 8.9k"), `cache read chip missing: ${text}`);
    assert(text.includes("Cache write 120"), `cache write chip missing: ${text}`);
    assert(/\d{1,2}:\d{2}/.test(text), "assistant time chip missing");
    const timeChips = container.querySelectorAll(".message-meta-chip.time");
    assert(timeChips.length === 1, `expected one time chip, got ${timeChips.length}`);
    const fullTitle = (timeChips[0] as HTMLElement).title;
    assert(fullTitle.includes(new Date().getFullYear().toString()), "time tooltip lacks full date");

    render(<MessageRow message={user} isRunning={false} />);
    const userText = container.textContent ?? "";
    assert(/\d{1,2}:\d{2}/.test(userText), "user time chip missing");
    assert(container.querySelectorAll(".message-row.user .message-meta-chip.time").length === 1, "user time chip not under bubble");

    // Older messages stamp with a short locale date instead of the clock time.
    const older = message("older", "user", "Earlier question", {
      createdAt: "2026-09-01T08:30:00.000Z",
    });
    render(<MessageRow message={older} isRunning={false} />);
    assert(/Sep 1/.test(container.textContent ?? ""), "older message lacks short date stamp");

    // A streaming turn must not show usage yet.
    render(<div />);
    renderTurn([user, answer], true);
    const streamingText = container.textContent ?? "";
    assert(!streamingText.includes("Input 12k"), "usage chips visible while streaming");
    assert(!streamingText.includes("gpt-test"), "model chip visible while streaming");

    // A turn without usage shows no usage or cache chips at all.
    render(<div />);
    const plain = message("plain", "assistant", "No usage here.", { createdAt: now });
    renderTurn([user, plain], false);
    const plainText = container.textContent ?? "";
    assert(!plainText.includes("Cache read"), "cache chip without usage");
    assert(!plainText.includes("Output 678"), "output chip without usage");

    // Leave the settled demo conversation on screen for the screenshot.
    const entry = buildTranscriptEntries([user, answer]).entries.find(
      (item) => item.kind === "assistant-turn",
    );
    assert(entry?.kind === "assistant-turn", "assistant turn missing");
    render(
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
        <MessageRow message={user} isRunning={false} />
        <AssistantTurn entry={entry} isActive={false} />
      </div>,
    );

    const chip = container.querySelector<HTMLElement>(".message-meta-chip");
    const chipRect = chip?.getBoundingClientRect();
    const diagnostics = {
      chipCount: container.querySelectorAll(".message-meta-chip").length,
      chipRect: chipRect
        ? { x: chipRect.x, y: chipRect.y, w: chipRect.width, h: chipRect.height }
        : null,
      chipColor: chip ? getComputedStyle(chip).color : null,
      chipVisible: chip ? getComputedStyle(chip).visibility : null,
      chipDisplay: chip ? getComputedStyle(chip).display : null,
      bodyRect: document.body.getBoundingClientRect().toJSON(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };

    return { ok: true, diagnostics };
};
