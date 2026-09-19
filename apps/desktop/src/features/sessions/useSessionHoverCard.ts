import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionSummary } from "@pi-desktop/shared";

export type SessionHoverCardData = {
  session: SessionSummary;
  target: HTMLElement;
  temporary: boolean;
  space: string;
  branch?: string;
};

export function useSessionHoverCard() {
  const [card, setCard] = useState<SessionHoverCardData | null>(null);
  const shownTargetRef = useRef<HTMLElement | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelDismiss = useCallback(() => {
    clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = undefined;
  }, []);

  const hide = useCallback(() => {
    cancelDismiss();
    shownTargetRef.current = null;
    setCard(null);
  }, [cancelDismiss]);

  const scheduleHide = useCallback(() => {
    cancelDismiss();
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = undefined;
      hide();
    }, 3000);
  }, [cancelDismiss, hide]);

  const show = useCallback((request: SessionHoverCardData) => {
    if (shownTargetRef.current === request.target) return;
    cancelDismiss();
    if (!request.target.isConnected || document.hidden) return;
    shownTargetRef.current = request.target;
    setCard(request);
  }, [cancelDismiss]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onVisibility = () => {
      if (document.hidden) hide();
    };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("pointerdown", hide);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelDismiss();
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("pointerdown", hide);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cancelDismiss, hide]);

  useEffect(() => {
    if (card && !card.target.isConnected) hide();
  });

  return { card, show, hide, scheduleHide, keepVisible: cancelDismiss };
}
