import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const menuSource = await readFile(
  new URL(
    "../src/features/chat/composer/ComposerContextMenu.tsx",
    import.meta.url,
  ),
  "utf8",
);
const inputSource = await readFile(
  new URL("../src/features/chat/composer/ComposerInput.tsx", import.meta.url),
  "utf8",
);
const actionsSource = await readFile(
  new URL(
    "../src/features/chat/context-menu/context-menu-actions.ts",
    import.meta.url,
  ),
  "utf8",
);
const shellSource = await readFile(
  new URL(
    "../src/features/chat/context-menu/use-chat-context-menu-shell.ts",
    import.meta.url,
  ),
  "utf8",
);

test("the composer input mounts its own right-click menu on the editor", () => {
  assert.match(inputSource, /<ComposerContextMenu inputRef=\{inputRef\} \/>/);
  // The menu scopes itself to its own editor instance instead of the
  // app-wide first `.composer-input` lookup.
  assert.match(menuSource, /inputRef\.current/);
  assert.match(menuSource, /addEventListener\("contextmenu", open\)/);
  // The transcript menu keeps its scroller attach point; the two never
  // attach to each other's surface.
  assert.doesNotMatch(menuSource, /scrollRef/);
});

test("a blocked or inert editor never opens the menu", () => {
  assert.match(menuSource, /if \(!editor\.isContentEditable\) return;/);
});

test("copy keeps draft-text semantics through the editor's own offsets", () => {
  assert.match(
    actionsSource,
    /export function composerSelectionText\(editor: HTMLElement\): string/,
  );
  assert.match(actionsSource, /editorSelectionRange\(editor\)/);
  assert.match(actionsSource, /readEditorValue\(editor\)\.slice\(start, end\)/);
  // Copy reads the selection captured when the menu opened, so the button
  // click that moves focus cannot empty it.
  assert.match(menuSource, /text: composerSelectionText\(editor\)/);
  assert.match(menuSource, /const text = menu\?\.text \?\? ""/);
  // No second DOM reduction exists: the menu copies draft text, not
  // Markdown, and never serializes the selection again.
  assert.doesNotMatch(actionsSource, /getSelection\(\)\.toString\(|cloneContents/);
});

test("composer paste replays the real pipeline at the captured selection", () => {
  assert.match(
    actionsSource,
    /export function pasteClipboardIntoComposerSelection\(/,
  );
  assert.match(actionsSource, /transfer\.setData\("text\/plain", text\)/);
  assert.match(actionsSource, /new ClipboardEvent\("paste"/);
  // The composer's menu paste stays at the captured caret exactly like
  // Ctrl+V; only the transcript's helper moves the caret to the draft's end.
  assert.match(actionsSource, /export function editorSelectionRangeAt\(/);
  assert.match(actionsSource, /range\.cloneRange\(\)/);
  assert.match(actionsSource, /selection\.addRange\(range\)/);
  // The menu snapshots the range before the item click can drop it.
  assert.match(menuSource, /const range = menu\?\.range \?\? null;/);
  assert.match(menuSource, /pasteClipboardIntoComposerSelection\(editor, text, range\)/);
  const selectionHelper = actionsSource.match(
    /export function pasteClipboardIntoComposerSelection[\s\S]*?\n\}/,
  );
  assert.ok(selectionHelper);
  assert.doesNotMatch(selectionHelper[0], /setEditorCaret/);
  assert.doesNotMatch(
    actionsSource,
    /execCommand|insertClipboardText|recordClipboardPaste/,
  );
});

test("the shared lifecycle consumes Escape while a menu is open", () => {
  assert.match(shellSource, /addEventListener\("keydown", onKeyDown, true\)/);
  assert.match(
    shellSource,
    /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*dismiss\(\);/s,
  );
});

test("menu shell matches the transcript floating menu contract", () => {
  assert.match(menuSource, /sidebar-row-menu sidebar-floating-menu/);
  assert.match(menuSource, /data-testid="composer-context-menu"/);
  assert.match(menuSource, /data-testid="composer-context-menu-copy"/);
  assert.match(menuSource, /data-testid="composer-context-menu-paste"/);
  assert.match(menuSource, /t\("chat\.copy"\)/);
  assert.match(menuSource, /t\("chat\.paste"\)/);
  assert.match(
    menuSource,
    /useChatContextMenuShell\(\{\s*open: menu !== null,\s*dismiss: \(\) => setMenu\(null\),\s*\}\)/s,
  );
});
