/**
 * Right-click menu for the conversation transcript (§7.4).
 *
 * A right click inside the transcript opens one renderer-owned, body-level
 * menu with Copy and Paste; nothing is ever sent. Copy reuses the quote
 * recovery path and Paste reuses the composer's real paste pipeline — the
 * actions live in context-menu-actions and the open-menu lifecycle (dismiss,
 * keyboard walk, clipboard probe) in useTranscriptContextMenuShell, so this
 * component only renders items and moves the pointer event into a state.
 * Read-only projections and hidden panes never mount the menu: the same gates
 * as the selection quote overlay guard it.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { RefObject } from "react";
import { useAppStore } from "../../../stores/app-store";
import {
  composerPasteTarget,
  copyTextToClipboard,
  liveSelectionMarkdown,
  pasteClipboardIntoComposer,
  selectionBelongsTo,
} from "./context-menu-actions";
import { useTranscriptContextMenuShell } from "./hooks/useTranscriptContextMenuShell";

/** Same fixed clamps as the link menus, so the menu never leaves the window. */
const MENU_WIDTH_MARGIN = 200;
const MENU_HEIGHT_MARGIN = 150;
/** Pointer offsets of the link menu contract. */
const MENU_OPEN_GAP = 4;

type TranscriptContextMenuState = {
  top: number;
  left: number;
  copyable: boolean;
  pasteBlocked: boolean;
};

export function TranscriptContextMenu({
  scrollRef,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const [menu, setMenu] = useState<TranscriptContextMenuState | null>(null);
  const { menuRef, clipboardEmpty, resetClipboardEmpty, onMenuKeyDown } =
    useTranscriptContextMenuShell({
      open: menu !== null,
      dismiss: () => setMenu(null),
    });

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const open = (event: MouseEvent) => {
      event.preventDefault();
      // A right click collapses nothing, so the live selection stays copyable.
      resetClipboardEmpty();
      setMenu({
        top: Math.min(
          event.clientY + MENU_OPEN_GAP,
          window.innerHeight - MENU_HEIGHT_MARGIN,
        ),
        left: Math.min(event.clientX, window.innerWidth - MENU_WIDTH_MARGIN),
        copyable: selectionBelongsTo(root),
        pasteBlocked: composerPasteTarget() === null,
      });
    };
    root.addEventListener("contextmenu", open);
    return () => root.removeEventListener("contextmenu", open);
  }, [scrollRef, resetClipboardEmpty]);

  const errorToast = (error: unknown) =>
    showToast(error instanceof Error ? error.message : String(error), {
      variant: "error",
    });

  const copySelection = async () => {
    setMenu(null);
    const markdown = liveSelectionMarkdown();
    if (!markdown) return;
    try {
      await copyTextToClipboard(markdown);
      showToast(t("chat.copied"), { variant: "success" });
    } catch (error) {
      errorToast(error);
    }
  };

  const pasteToComposer = async () => {
    setMenu(null);
    const editor = composerPasteTarget();
    if (!editor) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch (error) {
      errorToast(error);
      return;
    }
    if (!text.trim()) return;
    pasteClipboardIntoComposer(editor, text);
  };

  if (!menu) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="sidebar-row-menu sidebar-floating-menu"
      role="menu"
      data-testid="transcript-context-menu"
      style={{ top: menu.top, left: menu.left }}
      onKeyDown={onMenuKeyDown}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        data-testid="transcript-context-menu-copy"
        disabled={!menu.copyable}
        onClick={() => void copySelection()}
      >
        {t("chat.copy")}
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="transcript-context-menu-paste"
        disabled={menu.pasteBlocked || clipboardEmpty}
        onClick={() => void pasteToComposer()}
      >
        {t("chat.paste")}
      </button>
    </div>,
    document.body,
  );
}
