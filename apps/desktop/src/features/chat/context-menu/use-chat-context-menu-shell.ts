/**
 * Open-menu lifecycle for the chat right-click menus: the transcript's
 * (§7.4) and the composer's own (§11.5).
 *
 * One hook owns what happens while a menu is open — outside press, Escape,
 * and scroll dismissal, arrow-key walking, and the quiet OS-clipboard probe —
 * so the menu components stay renderers for the Copy/Paste actions. The
 * open state itself stays with each component: it knows the pointer geometry
 * and item enablement.
 */
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

export function useChatContextMenuShell({
  open,
  dismiss,
}: {
  open: boolean;
  dismiss: () => void;
}): {
  menuRef: RefObject<HTMLDivElement | null>;
  clipboardEmpty: boolean;
  resetClipboardEmpty: () => void;
  onMenuKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
} {
  const [clipboardEmpty, setClipboardEmpty] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Outside press, Escape, and any scroll close the menu, matching the link
  // menu's lifecycle. Escape is captured at the window so a focused
  // composer's own Escape handler cannot also clear the draft (§11.5).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open, dismiss]);

  // The OS clipboard may hold nothing; a quiet probe restores an honest
  // disabled state while the menu is open. A refused read keeps the item
  // enabled so a click surfaces the real clipboard error.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (!cancelled) setClipboardEmpty(text.trim().length === 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  const resetClipboardEmpty = () => setClipboardEmpty(false);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    );
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[next]?.focus();
  };

  return { menuRef, clipboardEmpty, resetClipboardEmpty, onMenuKeyDown };
}
