import { readAppSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const sidebarSource = await readFile(
  new URL("../src/components/Sidebar.tsx", import.meta.url),
  "utf8",
);
const hoverSource = await readFile(
  new URL("../src/features/sessions/SessionHoverCard.tsx", import.meta.url),
  "utf8",
);
const hoverHookSource = await readFile(
  new URL("../src/features/sessions/useSessionHoverCard.ts", import.meta.url),
  "utf8",
);
const globalStyles = await loadStyles();
const appSource = await readAppSource();
const panelSource = await readFile(
  new URL("../src/components/workpanel/WorkPanel.tsx", import.meta.url),
  "utf8",
);
const shortcutSource = await readFile(
  new URL("../../../packages/shared/src/keyboard-shortcuts.ts", import.meta.url),
  "utf8",
);
test("home sidebar exposes only the supported destination entries", () => {
  assert.match(sidebarSource, /data-nav="home"/);
  assert.match(sidebarSource, /data-nav="plugins"/);
  assert.doesNotMatch(sidebarSource, /data-nav="projects"/);
  assert.doesNotMatch(sidebarSource, /data-nav="pulls"/);
  assert.doesNotMatch(sidebarSource, /data-nav="scheduled"/);
  assert.doesNotMatch(sidebarSource, /t\("nav\.(?:pullRequests|scheduled)"\)/);
});

test("sidebar brand returns to the chat home", () => {
  const brandButton = sidebarSource.match(
    /<TooltipButton\s+type="button"\s+className="brand no-drag"[\s\S]*?<\/TooltipButton>/,
  )?.[0] ?? "";

  assert.match(brandButton, /data-nav="home"/);
  assert.match(brandButton, /ariaLabel=\{t\("nav\.home"\)\}/);
  assert.match(brandButton, /onClick=\{\(\) => setPage\("chat"\)\}/);
  assert.match(brandButton, /<BrandLogo size=\{20\}/);
  assert.match(brandButton, /t\("app\.shellName"\)/);
});

test("sidebar header retains non-mac branding and collapse without a search control", () => {
  const header = sidebarSource.match(
    /<div className="sidebar-header">[\s\S]*?<\/div>\s*<\/div>/,
  )?.[0] ?? "";

  assert.match(header, /className="brand no-drag"/);
  assert.match(header, /className="sidebar-header-actions no-drag"/);
  assert.doesNotMatch(header, /IconSearch/);
  assert.match(header, /<IconSidebar/);
  assert.match(header, /data-nav="toggle-sidebar"/);
  assert.doesNotMatch(appSource, /IconChevronLeft|IconChevronRight/);
});

test("work panel collapse control is the viewport-fixed shell toggle", () => {
  assert.match(appSource, /className="app-work-panel-toggle no-drag"/);
  assert.match(appSource, /collapseWorkPanel\(\)/);
  assert.doesNotMatch(panelSource, /onCollapse/);
  assert.doesNotMatch(panelSource, /work-panel-toolbar-collapse/);
  assert.doesNotMatch(panelSource, /work-panel-collapse/);
  assert.doesNotMatch(panelSource, /collapsePanel/);
  assert.match(
    globalStyles,
    /\.main-titlebar\.work-panel-open\s*\{[^}]*padding-right:\s*0;/s,
  );
  assert.match(
    globalStyles,
    /:root\[data-platform="win32"\] \.main-titlebar\.work-panel-open,[\s\S]*:root\[data-platform="linux"\] \.main-titlebar\.work-panel-open\s*\{[^}]*right:\s*0;/,
  );
  // The reservation is platform-scoped; the base header rule stays neutral.
  assert.doesNotMatch(
    globalStyles,
    /^\.work-panel-header\s*\{[^}]*margin-right:/ms,
  );
});

test("macOS hides sidebar branding and keeps header actions beside traffic lights", () => {
  assert.doesNotMatch(sidebarSource, /sidebar-macos-drag-row/);
  assert.match(
    globalStyles,
    /:root\[data-platform="darwin"\] \.sidebar-header\s*\{[^}]*padding-left:\s*76px;/s,
  );
  assert.match(
    globalStyles,
    /:root\[data-platform="darwin"\] \.sidebar-header > \.brand\s*\{[^}]*display:\s*none;/s,
  );
  assert.match(
    globalStyles,
    /:root\[data-platform="darwin"\]\[data-fullscreen="true"\] \.sidebar-header\s*\{[^}]*padding-left:\s*8px;/s,
  );
  assert.match(
    globalStyles,
    /\.sidebar-header-actions\s*\{[^}]*margin-left:\s*auto;/s,
  );
});

test("destination history is available through shortcuts without titlebar buttons", () => {
  assert.match(shortcutSource, /id: "navigateBack"[\s\S]*?"Mod\+BracketLeft"/);
  assert.match(appSource, /case "navigateBack"/);
  assert.match(appSource, /useAppStore\.getState\(\)\.navBack\(\)/);
  assert.match(shortcutSource, /id: "navigateForward"[\s\S]*?"Mod\+BracketRight"/);
  assert.match(appSource, /case "navigateForward"/);
  assert.match(appSource, /useAppStore\.getState\(\)\.navForward\(\)/);
  assert.doesNotMatch(appSource, /title=\{t\("nav\.(?:back|forward)"\)\}/);
});

test("sidebar shows a bounded standalone session list before retained projects", () => {
  const newProjectAction = sidebarSource.match(
    /<div[\s\S]*?className="sidebar-list-toolbar"[\s\S]*?data-action="new-project"[\s\S]*?<\/div>/,
  )?.[0] ?? "";
  const standaloneSessions = sidebarSource.match(
    /data-sidebar-session-section="temporary"[\s\S]*?<\/section>/,
  )?.[0] ?? "";

  assert.match(newProjectAction, /t\("nav\.projects"\)/);
  assert.match(newProjectAction, /<IconNewProject/);
  assert.match(newProjectAction, /openProjectPicker\(\)/);
  assert.match(standaloneSessions, /t\("nav\.sessions"/);
  assert.match(standaloneSessions, /data-action="new-standalone-session"/);
  assert.match(standaloneSessions, /createSession\(\{ projectPath: null \}\)/);
  assert.match(standaloneSessions, /renderSessionRows\(temporarySessionHistory/);
  assert.ok(
    sidebarSource.indexOf('data-sidebar-session-section="temporary"') <
      sidebarSource.indexOf('data-action="new-project"'),
  );
  // D465: the bounded standalone list is still five rows; the pitch pair it
  // multiplies is owned by tokens.css.
  assert.match(
    globalStyles,
    /\.sidebar-session-group-body\.standalone\s*\{[\s\S]*?max-height:\s*calc\(5 \* var\(--ds-sidebar-session-row-height\) \+ 4 \* var\(--ds-sidebar-session-row-gap\)\);[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/,
  );
  assert.doesNotMatch(sidebarSource, /data-sidebar-project-group="temporary"/);
});

test("sidebar session rows keep a roomier D465 pitch with a gap between rows", () => {
  // The row's own height is its two 6px insets plus the title's line box, so the
  // pitch tracks --font-scale instead of pinning a pixel count; 30px at scale 1.
  assert.match(
    globalStyles,
    /--ds-sidebar-session-row-height: calc\(12px \+ var\(--leading-row\)\)/,
  );
  assert.match(globalStyles, /--ds-sidebar-session-row-gap: 2px/);
  const rowRule = globalStyles.match(/^\.thread-item \{[^}]*\}/m)?.[0] ?? "";
  assert.match(rowRule, /min-height: var\(--ds-sidebar-session-row-height\)/);
  const mainRule = globalStyles.match(/^\.thread-item-main \{[^}]*\}/m)?.[0] ?? "";
  assert.match(mainRule, /padding: 6px 6px 6px 4px/);
  const bodyRule = globalStyles.match(/^\.sidebar-session-group-body \{[^}]*\}/m)?.[0] ?? "";
  assert.match(bodyRule, /gap: var\(--ds-sidebar-session-row-gap\)/);
  // The group block itself stays further apart than the rows inside it.
  const groupsRule = globalStyles.match(/^\.sidebar-session-groups \{[^}]*\}/m)?.[0] ?? "";
  assert.match(groupsRule, /gap: 4px/);
});

// The bounded standalone list has its own assertion above; the pinned section
// had none, which is how its old 224px literal (eight rows of the 28px pitch)
// survived the pitch change in specs and an ADR.
test("the pinned session list is bounded by whole rows of the D465 pitch", () => {
  // Eight rows, still capped by 30vh. Above a ~747px-tall window the row-derived
  // cap binds, so eight rows fit whole; below it the viewport term wins and may
  // cut the last visible row — that viewport cap is unchanged from before D465.
  assert.match(
    globalStyles,
    /\.sidebar-session-group-body\.pinned \{[^}]*?max-height: min\(calc\(8 \* var\(--ds-sidebar-session-row-height\) \+ 7 \* var\(--ds-sidebar-session-row-gap\)\), 30vh\)/s,
  );
});

test("sidebar project and session lists stay coordinated with the global type scale", () => {
  assert.match(
    globalStyles,
    /\.thread-item-title\s*\{[^}]*font-size:\s*var\(--text-md\);/s,
  );
  assert.match(
    globalStyles,
    /\.sidebar-session-group-title\s*\{[^}]*font-size:\s*var\(--text-md\);/s,
  );
  assert.match(
    globalStyles,
    /\.sidebar-session-empty\s*\{[^}]*font-size:\s*var\(--text-md\);/s,
  );
});

test("pinned project rows replace the folder glyph with a filled star", () => {
  assert.match(
    sidebarSource,
    /entry\.meta\.pinned \? \([\s\S]*?<IconStar\s+size=\{13\}\s+fill="currentColor"[\s\S]*?className="sidebar-project-pin"[\s\S]*?\) : \([\s\S]*?<IconFolder\s+size=\{13\}[\s\S]*?aria-hidden \/>/,
  );
  assert.match(
    globalStyles,
    /\.sidebar-project-pin\s*\{[^}]*flex:\s*0 0 auto;[^}]*color:\s*var\(--ds-accent\);/s,
  );
});

test("sidebar section toolbars open create actions from context menus", () => {
  assert.match(sidebarSource, /data-sidebar-section=\"sessions\"/);
  assert.match(sidebarSource, /data-sidebar-section=\"projects\"/);
  assert.match(sidebarSource, /openSectionMenu\(\"sessions\"/);
  assert.match(sidebarSource, /openSectionMenu\(\"projects\"/);
  assert.match(sidebarSource, /data-sidebar-section-menu=\{sectionMenu\}/);
  assert.match(
    sidebarSource,
    /className=\"sidebar-row-menu sidebar-floating-menu sidebar-section-menu\"/,
  );
  assert.match(sidebarSource, /e\.button === 2/);
  assert.match(sidebarSource, /addEventListener\("pointerdown"/);
});

test("sidebar floating menus open to the anchor's right", () => {
  const triggerPlacement = sidebarSource.match(
    /const placeMenu = useCallback\([\s\S]*?\n  }, \[\]\);/,
  )?.[0] ?? "";
  const pointPlacement = sidebarSource.match(
    /const placeMenuAtPoint = useCallback\([\s\S]*?\n  }, \[\]\);/,
  )?.[0] ?? "";

  assert.match(triggerPlacement, /left:\s*Math\.max\(/);
  assert.match(triggerPlacement, /rect\.right \+ 4/);
  assert.doesNotMatch(triggerPlacement, /window\.innerWidth/);
  assert.doesNotMatch(triggerPlacement, /right:\s*Math\.max/);
  assert.match(pointPlacement, /left:\s*Math\.max\(/);
  assert.match(pointPlacement, /x \+ 4/);
  assert.doesNotMatch(pointPlacement, /window\.innerWidth/);
  assert.match(sidebarSource, /placeMenuAtPoint\(event\.clientX, event\.clientY\)/);
  assert.match(sidebarSource, /left: menuPosition\.left/);
  assert.doesNotMatch(sidebarSource, /right: menuPosition\.right/);
});

test("portaled sort menu does not stretch to the viewport edge", () => {
  const basePopoverRule = globalStyles.match(
    /\.sidebar-row-menu,\n\.sidebar-popover\s*\{[^}]*\}/s,
  )?.[0] ?? "";
  const floatingPopoverRule =
    globalStyles.match(/\.sidebar-popover\.sidebar-floating-menu\s*\{[^}]*\}/s)?.[0] ?? "";

  assert.match(basePopoverRule, /position:\s*fixed;/);
  assert.doesNotMatch(basePopoverRule, /position:\s*absolute;/);
  assert.match(floatingPopoverRule, /top:\s*auto;/);
  assert.match(floatingPopoverRule, /right:\s*auto;/);
  assert.match(globalStyles, /\.sidebar-floating-menu\s*\{[^}]*width:\s*max-content;/s);
  assert.match(globalStyles, /\.sidebar-floating-menu\s*\{[^}]*max-width:\s*calc\(100vw - 16px\);/s);
});

test("sessions toolbar puts sorting before new-session creation", () => {
  const sortIndex = sidebarSource.indexOf('data-action="session-sort"');
  const newSessionIndex = sidebarSource.indexOf('data-action="new-standalone-session"');

  assert.ok(sortIndex >= 0);
  assert.ok(newSessionIndex >= 0);
  assert.ok(sortIndex < newSessionIndex);
});

test("sidebar action icons stay quiet until their toolbar or row is hovered", () => {
  const toolbarButton = globalStyles.match(
    /\.sidebar-toolbar-button\s*\{[^}]+\}/s,
  )?.[0] ?? "";
  assert.match(toolbarButton, /opacity:\s*0/);
  assert.match(
    globalStyles,
    /\.sidebar-list-toolbar:hover \.sidebar-toolbar-button,[\s\S]*?\.sidebar-list-toolbar:focus-within \.sidebar-toolbar-button,[\s\S]*?opacity:\s*1;/,
  );
  assert.match(globalStyles, /\.thread-item:hover \.thread-item-more,/);
  assert.match(
    globalStyles,
    /\.sidebar-session-group-header:hover \.thread-item-more,[\s\S]*?\.sidebar-session-group-header:focus-within \.thread-item-more,/,
  );
  assert.match(
    globalStyles,
    /\.sidebar-session-group-header:hover \.sidebar-session-group-add,[\s\S]*?\.sidebar-session-group-header:focus-within \.sidebar-session-group-add,[\s\S]*?opacity:\s*1;/,
  );
});

test("project rows expose folder actions and full-path hover", () => {
  assert.match(sidebarSource, /data-action="open-project-folder"/);
  assert.match(sidebarSource, /api\.openProjectFolder\(entry\.path\)/);
  assert.doesNotMatch(sidebarSource, /data-action="edit-project-instructions"/);
  assert.doesNotMatch(sidebarSource, /<ProjectInstructionsDialog/);
  assert.doesNotMatch(sidebarSource, /data-action="open-session-folder"/);
  assert.doesNotMatch(sidebarSource, /api\.openSessionFolder\(/);
  assert.match(
    sidebarSource,
    /className="sidebar-session-group-title project-toggle"[\s\S]*?tooltip=\{entry\.path\}[\s\S]*?tooltipDelayMs=\{500\}[\s\S]*?aria-describedby=\{`\$\{projectId\}-path-description`\}/,
  );
  assert.match(sidebarSource, /<TooltipButton/);
  assert.match(globalStyles, /\.ui-tooltip-path\s*\{[^}]*width:\s*max-content/);
  assert.match(globalStyles, /\.ui-tooltip-path\s*\{[^}]*max-width:\s*min\(420px,\s*calc\(100vw - 16px\)\)/);
  assert.match(sidebarSource, /className="sr-only">\s*\{entry\.path\}/);
});

test("sidebar row menus omit project reassignment and switching actions", () => {
  assert.doesNotMatch(sidebarSource, /data-action="move-session-to-project"/);
  assert.doesNotMatch(sidebarSource, /t\("nav\.moveToProject"/);
  assert.doesNotMatch(sidebarSource, /t\("project\.switch"/);
  assert.match(
    sidebarSource,
    /if \(!entry\.active && !\(await selectProject\(entry\.path\)\)\) return;/,
  );
});

test("session rows show the title alone in a column no status marker shifts", () => {
  // D453 gave the row button a conditional `marked` class, so the row's markup
  // is a template literal rather than a plain attribute.
  const sessionMain = sidebarSource.match(
    /className=\{`thread-item-main[^`]*`\}[\s\S]*?<\/button>/,
  )?.[0] ?? "";

  // D450: the row carries nothing but its title, so the transcript's newest
  // message stays out of the list and only the title competes for row width.
  assert.match(
    sessionMain,
    /<span className="thread-item-text">\s*<span className="thread-item-title">\{taskTitle\(session\.title\)\}<\/span>\s*<\/span>/,
  );
  assert.doesNotMatch(sessionMain, /thread-item-preview|session\.lastMessage/);
  assert.match(
    globalStyles,
    /\.thread-item-text\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;[^}]*flex-direction:\s*column;/s,
  );
  assert.doesNotMatch(globalStyles, /\.thread-item-preview\s*\{/s);
});

test("session rows use the hover card instead of a native title tooltip", () => {
  // D453 gave the row button a conditional `marked` class, so the row's markup
  // is a template literal rather than a plain attribute.
  const sessionMain = sidebarSource.match(
    /className=\{`thread-item-main[^`]*`\}[\s\S]*?<\/button>/,
  )?.[0] ?? "";

  assert.match(sessionMain, /showSessionHoverCard\(/);
  assert.doesNotMatch(sessionMain, /title=\{taskTitle\(session\.title\)\}/);
  // The row button carries no native title tooltip at all. The status pill's own
  // label lives on the pill's element inside `renderSessionStatus`, not inline
  // in the row markup, so the row segment holds no `title=` attribute.
  assert.deepEqual(
    [...sessionMain.matchAll(/\btitle=\{([^}]*)\}/g)].map((match) => match[1]),
    [],
  );
  assert.match(
    sidebarSource,
    /<span className=\{`thread-item-status \$\{status\}`\} aria-label=\{label\} title=\{label\}>/,
    "the pill keeps its label as its own tooltip",
  );
  assert.match(hoverSource, /className="sidebar-session-hover-card"/);
  assert.match(hoverSource, /className="sidebar-session-hover-card-title"/);
  assert.match(sessionMain, /onFocusCapture=/);
  assert.match(sessionMain, /aria-describedby=/);
  assert.match(hoverHookSource, /setCard\(request\);/);
  assert.doesNotMatch(hoverHookSource, /\}, 500\)/, "the card reveals instantly, no 500ms timer");
  assert.match(hoverHookSource, /event\.key === "Escape"/);
  assert.match(hoverHookSource, /addEventListener\("scroll", hide, true\)/);
  assert.match(hoverHookSource, /addEventListener\("visibilitychange", onVisibility\)/);
});

test("session hover cards expose readable models and keyboard-navigable session links", () => {
  assert.match(hoverSource, /role="dialog"/);
  assert.match(hoverSource, /summary\?\.providerName/);
  assert.match(hoverSource, /summary\?\.modelName/);
  assert.doesNotMatch(hoverSource, /modelKey\?\.includes\("\/"\)/);
  assert.match(hoverSource, /data-session-link=\{summary\.createdBySession\.sessionId\}/);
  assert.match(hoverSource, /summary\.createdSessions\.slice\(0, 8\)/);
  assert.match(hoverSource, /type="button"/);
  assert.match(hoverSource, /onClick=\{\(\) => openSessionReference/);
  assert.match(hoverSource, /onFocusCapture=\{keepVisible\}/);
  assert.match(hoverHookSource, /setTimeout\(\(\) => \{[\s\S]*?hide\(\);[\s\S]*?\}, 3000\)/);
  assert.match(globalStyles, /\.sidebar-session-hover-card\s*\{[\s\S]*?pointer-events:\s*auto;/);
  assert.match(globalStyles, /\.sidebar-session-hover-card-session-link:focus-visible\s*\{[\s\S]*?outline:/);
});
