import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { QuitDialogChoice, QuitDialogRequest } from "@pi-desktop/shared";
import { api } from "../lib/api";
import { Button, TooltipButton } from "./ui";
import {
  IconCircleAlert,
  IconClose,
  IconMinus,
  IconPower,
} from "./icons";

/**
 * Renders the main process's quit / close-behavior confirmation (D452) and
 * answers it over IPC. This host is the only confirmation UI: it acknowledges
 * the request once the dialog is on screen, so main can wait for a slow user
 * without ever having to fall back to a native message box (D469).
 */
export function QuitDialogHost() {
  const { t } = useTranslation();
  const [request, setRequest] = useState<QuitDialogRequest | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // One confirmation at a time. A request this host never showed is neither
  // acknowledged nor answered, and main settles it on its own budget.
  const activeRequestId = useRef<string | null>(null);

  useEffect(() => {
    return api.onQuitDialogRequest((next) => {
      if (activeRequestId.current) return;
      activeRequestId.current = next.requestId;
      void api.presentQuitDialog({ requestId: next.requestId });
      setRequest(next);
    });
  }, []);

  useEffect(() => {
    return api.onQuitDialogDismiss(({ requestId }) => {
      if (activeRequestId.current !== requestId) return;
      activeRequestId.current = null;
      setRequest(null);
    });
  }, []);

  const settle = useCallback((choice: QuitDialogChoice) => {
    const requestId = activeRequestId.current;
    activeRequestId.current = null;
    setRequest(null);
    if (requestId) void api.respondQuitDialog({ requestId, choice });
  }, []);

  const defaultChoice: QuitDialogChoice =
    request?.kind === "close-ask" ? "tray" : "confirm";

  useEffect(() => {
    if (!request) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => dialogRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        settle("cancel");
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        settle(defaultChoice);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled])",
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [request, defaultChoice, settle]);

  if (!request) return null;

  const dialog = (
    <div className="overlay quit-dialog-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="dialog quit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quit-dialog-title"
        tabIndex={-1}
      >
        {request.kind === "quit-confirm" ? (
          <QuitConfirmBody request={request} onSettle={settle} titleId="quit-dialog-title" />
        ) : (
          <CloseAskBody onSettle={settle} titleId="quit-dialog-title" />
        )}
      </div>
    </div>
  );

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);

  function QuitConfirmBody({
    request,
    onSettle,
    titleId,
  }: {
    request: QuitDialogRequest;
    onSettle: (choice: QuitDialogChoice) => void;
    titleId: string;
  }) {
    const running = request.runningTurns;
    return (
      <>
        <div className="quit-dialog-head">
          <h2 id={titleId} className="quit-dialog-title">
            <IconCircleAlert size={17} className="quit-dialog-title-icon" aria-hidden />
            {t("tray.confirmQuitTitle")}
          </h2>
          <TooltipButton
            type="button"
            className="quit-dialog-close"
            tooltip={t("common.cancel")}
            ariaLabel={t("common.cancel")}
            onClick={() => onSettle("cancel")}
          >
            <IconClose size={16} />
          </TooltipButton>
        </div>
        {running > 0 ? (
          <>
            <p className="quit-dialog-body">{t("tray.confirmQuitIntro")}</p>
            <div className="quit-dialog-impact">
              <div className="quit-dialog-impact-row">
                <span className="quit-dialog-impact-count">{running}</span>
                <span>{t("tray.confirmQuitRunning", { sessions: running })}</span>
              </div>
              <div className="quit-dialog-impact-row">
                <span className="quit-dialog-impact-count neutral">!</span>
                <span>{t("tray.confirmQuitDrafts")}</span>
              </div>
            </div>
          </>
        ) : (
          <p className="quit-dialog-body">{t("tray.confirmQuitBody")}</p>
        )}
        <div className="quit-dialog-actions">
          <Button type="button" variant="ghost" onClick={() => onSettle("cancel")}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            className="quit-dialog-confirm"
            onClick={() => onSettle("confirm")}
          >
            {t("tray.confirmQuit")}
          </Button>
        </div>
      </>
    );
  }

  function CloseAskBody({
    onSettle,
    titleId,
  }: {
    onSettle: (choice: QuitDialogChoice) => void;
    titleId: string;
  }) {
    return (
      <>
        <div className="quit-dialog-head">
          <h2 id={titleId} className="quit-dialog-title">
            {t("tray.askTitle")}
          </h2>
          <TooltipButton
            type="button"
            className="quit-dialog-close"
            tooltip={t("common.cancel")}
            ariaLabel={t("common.cancel")}
            onClick={() => onSettle("cancel")}
          >
            <IconClose size={16} />
          </TooltipButton>
        </div>
        <div className="quit-dialog-choices">
          <button
            type="button"
            className="quit-dialog-choice is-default"
            onClick={() => onSettle("tray")}
          >
            <IconMinus size={16} className="quit-dialog-choice-icon" aria-hidden />
            <span className="quit-dialog-choice-text">
              <span className="quit-dialog-choice-label">{t("tray.closeToTray")}</span>
              <span className="quit-dialog-choice-desc">{t("tray.askTrayDesc")}</span>
            </span>
            <span className="quit-dialog-choice-kbd">Enter</span>
          </button>
          <button
            type="button"
            className="quit-dialog-choice"
            onClick={() => onSettle("quit")}
          >
            <IconPower size={16} className="quit-dialog-choice-icon" aria-hidden />
            <span className="quit-dialog-choice-text">
              <span className="quit-dialog-choice-label">{t("tray.quit")}</span>
              <span className="quit-dialog-choice-desc">{t("tray.askQuitDesc")}</span>
            </span>
          </button>
        </div>
        <div className="quit-dialog-foot">
          <Button
            type="button"
            variant="ghost"
            style={{ paddingLeft: 0 }}
            onClick={() => onSettle("cancel")}
          >
            {t("common.cancel")}
          </Button>
          <span className="quit-dialog-hint">{t("tray.askSettingsHint")}</span>
        </div>
      </>
    );
  }
}
