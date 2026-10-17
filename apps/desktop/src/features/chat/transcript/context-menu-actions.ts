/**
 * The two actions behind the transcript's right-click menu (§7.4).
 *
 * Reuse is the point: the copy returns rendered text to Markdown through the
 * quote recovery path (one serialization shared with the selection pill), and
 * the paste replays the OS clipboard text into the composer's own `onPaste`
 * pipeline, so clipboard-history records, line-ending normalization, and the
 * large-text → scratch reference conversion (ADR 0131) stay one shared code
 * path instead of a second composer insertion flow.
 */
import {
  activeSelectionRange,
  serializeSelectionMarkdown,
} from "../../../lib/selection-quote";
import { readEditorValue, setEditorCaret } from "../composer/editor";

/** The one rich composer input app-wide; home and docked variants share it. */
const COMPOSER_EDITOR_SELECTOR = ".composer-input";

/**
 * The live selection reduced back to Markdown, or null when the selection is
 * gone or empty. The caller owns feedback; this only serializes.
 */
export function liveSelectionMarkdown(): string | null {
  const markdown = serializeSelectionMarkdown(activeSelectionRange());
  return markdown || null;
}

/** Write text to the OS clipboard; the promise carries any refusal. */
export function copyTextToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

/**
 * The editable composer input, or null while it is inert: a pane being left
 * (inert composer), a paste still saving, or nothing mounted.
 */
export function composerPasteTarget(): HTMLElement | null {
  const editor = document.querySelector<HTMLElement>(COMPOSER_EDITOR_SELECTOR);
  return editor?.isContentEditable ? editor : null;
}

/**
 * Whether the live selection starts inside `root`: the pane the user
 * right-clicked owns its own selection; another pane's selection must not
 * enable this menu's Copy item.
 */
export function selectionBelongsTo(root: Element | null): boolean {
  const range = activeSelectionRange();
  return Boolean(range && root?.contains(range.startContainer));
}
/**
 * Deliver the OS clipboard's text to the composer's real paste handler:
 * focus lands in the composer with the caret at the draft's end, and the
 * dispatched `paste` event carries the text as `text/plain` so the composer
 * keeps its single normalization, history, and reference-chip contract.
 */
export function pasteClipboardIntoComposer(
  editor: HTMLElement,
  text: string,
): void {
  editor.focus();
  setEditorCaret(editor, readEditorValue(editor).length);
  const transfer = new DataTransfer();
  transfer.setData("text/plain", text);
  editor.dispatchEvent(
    new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }),
  );
}
