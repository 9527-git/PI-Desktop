/**
 * The actions behind the chat right-click menus: the transcript's menu
 * (§7.4) and the composer's own menu (§11.5).
 *
 * Reuse is the point: the transcript copy returns rendered text to Markdown
 * through the quote recovery path (one serialization shared with the
 * selection pill), and both menus replay the OS clipboard text into the
 * composer's own `onPaste` pipeline, so clipboard-history records,
 * line-ending normalization, and the large-text → scratch reference
 * conversion (ADR 0131) stay one shared code path instead of a second
 * composer insertion flow. They differ only where their surfaces differ:
 * the transcript never knew a composer caret, so its paste lands at the
 * draft's end, while the composer's own menu pastes at the caret or selection
 * it captured on open, exactly like Ctrl+V.
 */
import {
  activeSelectionRange,
  serializeSelectionMarkdown,
} from "../../../lib/selection-quote";
import {
  editorSelectionRange,
  readEditorValue,
  setEditorCaret,
} from "../composer/editor";

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
 * The selection inside one composer editor as plain draft text, or "" when
 * nothing is selected: the editor's own value/selection offsets keep a
 * reference chip at its one-character token, so this never serializes the
 * DOM back to Markdown.
 */
export function composerSelectionText(editor: HTMLElement): string {
  const { start, end } = editorSelectionRange(editor);
  if (end <= start) return "";
  return readEditorValue(editor).slice(start, end);
}

/**
 * The live caret or selection inside one editor as a DOM range, or null when
 * the selection lives elsewhere. Menu actions restore it before pasting:
 * clicking a menu button moves focus out of the editable, and a lost
 * selection would otherwise send the paste to the draft's end. A collapsed
 * range is the ordinary right-click caret and stays valid.
 */
export function editorSelectionRangeAt(editor: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return null;
  return range.cloneRange();
}

/**
 * Deliver the OS clipboard's text to the composer's real paste handler:
 * the dispatched `paste` event carries the text as `text/plain` so the
 * composer keeps its single normalization, history, and reference-chip
 * contract. Neither focus nor caret moves; the caller decides where the
 * insertion point belongs.
 */
function dispatchComposerPaste(editor: HTMLElement, text: string): void {
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

/**
 * Transcript-menu paste: focus lands in the composer with the caret at the
 * draft's end — the transcript never knew where the composer's caret was —
 * then the paste event replays the text.
 */
export function pasteClipboardIntoComposer(
  editor: HTMLElement,
  text: string,
): void {
  editor.focus();
  setEditorCaret(editor, readEditorValue(editor).length);
  dispatchComposerPaste(editor, text);
}

/**
 * Composer-menu paste: paste exactly like Ctrl+V at the selection the menu
 * captured when it opened. The saved range is restored after focus, so a
 * button click that dropped the editor's selection cannot push the text to
 * the draft's end.
 */
export function pasteClipboardIntoComposerSelection(
  editor: HTMLElement,
  text: string,
  range: Range | null,
): void {
  editor.focus();
  if (range && editor.contains(range.startContainer)) {
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  dispatchComposerPaste(editor, text);
}
