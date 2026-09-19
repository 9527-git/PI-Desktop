/**
 * The session hover card lingers 3s after the pointer leaves so the user can
 * reach the copy button, the session id exposes one-click copy, and preview
 * text renders through the shared inline-markdown styling. The hook and the
 * card need a DOM to run, so — matching session-collaboration-navigation.test.mjs —
 * the contract is asserted against source.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hookSource = await readFile(
  new URL("../src/features/sessions/useSessionHoverCard.ts", import.meta.url),
  "utf8",
);
const hoverSource = await readFile(
  new URL("../src/features/sessions/SessionHoverCard.tsx", import.meta.url),
  "utf8",
);
const sessionsCss = await readFile(
  new URL("../src/styles/sessions.css", import.meta.url),
  "utf8",
);
const messagesCss = await readFile(
  new URL("../src/styles/messages.css", import.meta.url),
  "utf8",
);

test("the card lingers 3 seconds after the pointer leaves", () => {
  const scheduleHide = hookSource.match(
    /const scheduleHide = useCallback\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/,
  )?.[0] ?? "";
  assert.match(scheduleHide, /setTimeout\([\s\S]*?hide\(\);[\s\S]*?\}, 3000\);/, "dismiss dwell is 3s");
  assert.doesNotMatch(scheduleHide, /160/, "the old 160ms grace is gone");
  assert.match(hoverSource, /onMouseLeave=\{scheduleHide\}/, "the card itself keeps the dwell");
  assert.match(hoverSource, /onMouseEnter=\{keepVisible\}/, "re-entering cancels the dwell");
});

test("the session id row exposes a one-click copy", () => {
  const idRow = hoverSource.match(
    /<div className="sidebar-session-hover-card-id-row">[\s\S]*?<\/div>/,
  )?.[0] ?? "";
  assert.match(idRow, /<code className="sidebar-session-hover-card-id">\{session\.id\}<\/code>/, "the id stays visible");
  assert.match(idRow, /<button/, "copy is a real button");
  assert.match(idRow, /data-action="copy-session-id"/);
  assert.match(idRow, /onClick=\{\(\) => copy\(session\.id\)\}/);
  assert.match(idRow, /title=\{t\("nav\.copyConversationId"\)\}/);
  assert.match(idRow, /aria-label=\{t\("nav\.copyConversationId"\)\}/);
  assert.match(idRow, /copied \? <IconCheck[\s\S]*: <IconCopy/, "the button confirms the copy");
  assert.match(hoverSource, /const \{ copied, copy \} = useCopy\(\);/, "reuses the shared copy hook");
  assert.match(sessionsCss, /\.sidebar-session-hover-card-id-row \{[^}]*display: flex/, "the id row keeps code and button on one line");
});

test("card previews render inline markdown with the shared tint tokens", () => {
  const previews = [...hoverSource.matchAll(/<span className="sidebar-session-hover-card-preview"><MarkdownInline source=\{sessionPreview\(([^)]*)\)\} \/><\/span>/g)];
  assert.equal(previews.length, 3, "current task, recent exchanges and the result all render inline markdown");

  for (const selector of ["code", "strong", ".md-inline-path"]) {
    assert.match(
      messagesCss,
      new RegExp(`\\.sidebar-session-hover-card-preview ${selector.replace(".", "\\.")} \\{`),
      `${selector} picks up the one-line-summary color treatment`,
    );
  }
});
