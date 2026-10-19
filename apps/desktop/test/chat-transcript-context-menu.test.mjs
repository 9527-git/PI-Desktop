import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const menuSource = await readFile(
  new URL("../src/features/chat/transcript/TranscriptContextMenu.tsx", import.meta.url),
  "utf8",
);
const actionsSource = await readFile(
  new URL("../src/features/chat/context-menu/context-menu-actions.ts", import.meta.url),
  "utf8",
);
const transcriptSource = await readFile(
  new URL("../src/features/chat/transcript/ChatTranscript.tsx", import.meta.url),
  "utf8",
);

test("transcript context menu reuses the quote's selection → Markdown path", () => {
  assert.match(actionsSource, /serializeSelectionMarkdown\(activeSelectionRange\(\)\)/);
  assert.match(actionsSource, /navigator\.clipboard\.writeText\(text\)/);
  // Copy stays native: no second DOM reduction exists in the actions module.
  assert.doesNotMatch(actionsSource, /cloneContents|getSelection\(\)\.toString\(/);
});

test("transcript context menu paste replays the composer's real paste pipeline", () => {
  assert.match(
    actionsSource,
    /new ClipboardEvent\("paste",\s*\{[\s\S]*?clipboardData: transfer,?[\s\S]*?\}\)/,
  );
  assert.match(actionsSource, /transfer\.setData\("text\/plain", text\)/);
  assert.match(actionsSource, /editor\.dispatchEvent\(/);
  assert.match(actionsSource, /setEditorCaret\(editor, readEditorValue\(editor\)\.length\)/);
  // The composer's own handler carries clipboard-history records, line-ending
  // normalization, and the large-text scratch-chip rule, so the actions module
  // must not reimplement insertion logic.
  assert.doesNotMatch(actionsSource, /execCommand|insertClipboardText|recordClipboardPaste/);
});

test("paste refuses an inert or missing composer input", () => {
  assert.match(actionsSource, /\.composer-input/);
  assert.match(actionsSource, /isContentEditable/);
});

test("only the active readable transcript mounts the menu", () => {
  assert.match(
    transcriptSource,
    /transcriptReadOnly \|\| !paneVisible \? null : \(\s*<TranscriptContextMenu scrollRef=\{scrollRef\} \/>/s,
  );
  // The transcript menu never attaches to the composer: the composer owns
  // its separate §11.5 menu on the editor element.
  assert.match(menuSource, /scrollRef\.current/);
  assert.match(menuSource, /addEventListener\("contextmenu", open\)/);
  assert.doesNotMatch(menuSource, /\.composer-input/);
});
test("menu dismissal and probe live in one lifecycle hook", async () => {
  const shellSource = await readFile(
    new URL("../src/features/chat/context-menu/use-chat-context-menu-shell.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    menuSource,
    /useChatContextMenuShell\(\{\s*open: menu !== null,\s*dismiss: \(\) => setMenu\(null\),\s*\}\)/s,
  );
  assert.match(shellSource, /addEventListener\("pointerdown", onPointerDown\)/);
  assert.match(shellSource, /navigator\.clipboard\s*\.readText\(\)/);
  assert.match(shellSource, /items\[next\]\?\.focus\(\)/);
});

const localeStyle = new Map([
  ["en", 'paste: "Paste"'],
  ["zh-CN", 'paste: "粘贴"'],
  ["zh-TW", 'paste: "貼上"'],
  ["de", '"paste": "Einfügen"'],
  ["es", '"paste": "Pegar"'],
  ["fr", '"paste": "Coller"'],
  ["ko", 'paste: "붙여넣기"'],
  ["tr", 'paste: "Yapıştır"'],
]);

test("chat context menu labels ship in every locale catalog", async () => {
  for (const [locale, expected] of localeStyle) {
    const catalog = await readFile(
      new URL(`../../../packages/i18n/src/locales/${locale}/index.ts`, import.meta.url),
      "utf8",
    );
    const chatBlock = catalog.match(/(^|\s)chat: \{|"chat": \{/);
    assert.ok(chatBlock, `${locale} exports a chat block`);
    const tail = catalog.slice(chatBlock.index);
    assert.ok(tail.includes(expected), `${locale} ships the paste wording`);
    assert.ok(/copy: "|"copy": "/.test(tail), `${locale} keeps the copy wording`);
  }
});
