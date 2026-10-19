/**
 * Right-click menu for the composer input (§11.5).
 *
 * A right click inside the editor opens one renderer-owned, body-level menu
 * with Copy and Paste; nothing is ever sent. Both items act on the selection
 * captured when the menu opened — clicking an item moves focus out of the
 * editor, so a live re-read would lose the range. Copy writes that draft text
 * and Paste restores the range, then replays the OS clipboard text through
 * the composer's own paste pipeline — the actions live in the shared
 * context-menu module and the open-menu lifecycle in useChatContextMenuShell,
 * so this component only renders items and moves the pointer event into a
 * state. It scopes everything to this editor instance instead of the
 * app-wide first `.composer-input` lookup:
 * home and docked variants never read each other's selection. A blocked or
 * inert editor (approval, native run, pane teardown) never opens the menu.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { RefObject } from "react";
import { useAppStore } from "../../../stores/app-store";
import {
  composerSelectionText,
  copyTextToClipboard,
  editorSelectionRangeAt,
  pasteClipboardIntoComposerSelection,
} from "../context-menu/context-menu-actions";
import { useChatContextMenuShell } from "../context-menu/use-chat-context-menu-shell";

/** Same fixed clamps as the link and transcript menus. */
const MENU_WIDTH_MARGIN = 200;
const MENU_HEIGHT_MARGIN = 150;
/** Pointer offset of the floating menu contract. */
const MENU_OPEN_GAP = 4;

type ComposerContextMenuState = {
  top: number;
  left: number;
  /** Draft text selected at open time; "" disables Copy. */
  text: string;
  /** The editor selection at open time, so action clicks cannot lose it. */
  range: Range | null;
};

export function ComposerContextMenu({
  inputRef,
}: {
  inputRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const [menu, setMenu] = useState<ComposerContextMenuState | null>(null);
  const { menuRef, clipboardEmpty, resetClipboardEmpty, onMenuKeyDown } =
    useChatContextMenuShell({
      open: menu !== null,
      dismiss: () => setMenu(null),
    });

  useEffect(() => {
    const editor = inputRef.current;
    if (!editor) return;
    const open = (event: MouseEvent) => {
      // Mirror the transcript's read-only gate: a blocked editor keeps its
      // aria-readonly contentEditable state, and nothing else has to know.
      if (!editor.isContentEditable) return;
      event.preventDefault();
      resetClipboardEmpty();
      setMenu({
        top: Math.min(
          event.clientY + MENU_OPEN_GAP,
          window.innerHeight - MENU_HEIGHT_MARGIN,
        ),
        left: Math.min(event.clientX, window.innerWidth - MENU_WIDTH_MARGIN),
        text: composerSelectionText(editor),
        range: editorSelectionRangeAt(editor),
      });
    };
    editor.addEventListener("contextmenu", open);
    return () => editor.removeEventListener("contextmenu", open);
  }, [inputRef, resetClipboardEmpty]);

  const errorToast = (error: unknown) =>
    showToast(error instanceof Error ? error.message : String(error), {
      variant: "error",
    });

  const copySelection = async () => {
    const text = menu?.text ?? "";
    setMenu(null);
    if (!text) return;
    try {
      await copyTextToClipboard(text);
      showToast(t("chat.copied"), { variant: "success" });
    } catch (error) {
      errorToast(error);
    }
  };

  const pasteAtSelection = async () => {
    const range = menu?.range ?? null;
    setMenu(null);
    const editor = inputRef.current;
    if (!editor) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch (error) {
      errorToast(error);
      return;
    }
    if (!text.trim()) return;
    pasteClipboardIntoComposerSelection(editor, text, range);
  };

  if (!menu) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="sidebar-row-menu sidebar-floating-menu"
      role="menu"
      data-testid="composer-context-menu"
      style={{ top: menu.top, left: menu.left }}
      onKeyDown={onMenuKeyDown}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        data-testid="composer-context-menu-copy"
        disabled={!menu.text}
        onClick={() => void copySelection()}
      >
        {t("chat.copy")}
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="composer-context-menu-paste"
        disabled={clipboardEmpty}
        onClick={() => void pasteAtSelection()}
      >
        {t("chat.paste")}
      </button>
    </div>,
    document.body,
  );
}
