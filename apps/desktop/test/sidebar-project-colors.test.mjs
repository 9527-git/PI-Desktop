import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PROJECT_COLOR_PALETTE,
  resolveProjectColor,
} from "../src/lib/project-colors.ts";
import {
  loadSidebarPreferences,
  normalizeProjectColor,
  saveSidebarPreferences,
} from "../src/lib/sidebar-preferences.ts";
import { readStoreModule } from "./helpers/source-contracts.mjs";

const projectSliceSource = await readStoreModule("slices/project-slice.ts");
const sidebarSource = await readFile(
  new URL("../src/components/Sidebar.tsx", import.meta.url),
  "utf8",
);
const threadsCss = await readFile(
  new URL("../src/styles/sidebar-threads.css", import.meta.url),
  "utf8",
);
const tokensCss = await readFile(
  new URL("../src/styles/tokens.css", import.meta.url),
  "utf8",
);

const paletteHexes = PROJECT_COLOR_PALETTE.map((entry) => entry.hex);

function withMemoryLocalStorage(run) {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
    key() {
      return null;
    },
    get length() {
      return values.size;
    },
  };
  try {
    return run();
  } finally {
    globalThis.localStorage = previousStorage;
  }
}

test("project color palette holds ten unique #rrggbb colors", () => {
  assert.equal(paletteHexes.length, 10);
  assert.equal(new Set(paletteHexes).size, paletteHexes.length);
  for (const hex of paletteHexes) {
    assert.match(hex, /^#[0-9a-f]{6}$/);
  }
});

test("normalizeProjectColor accepts only #rrggbb", () => {
  assert.equal(normalizeProjectColor("#5B9DFF"), "#5b9dff");
  assert.equal(normalizeProjectColor("  #5b9dff  "), "#5b9dff");
  assert.equal(normalizeProjectColor("#abc"), undefined);
  assert.equal(normalizeProjectColor("5b9dff"), undefined);
  assert.equal(normalizeProjectColor("#5b9dff00"), undefined);
  assert.equal(normalizeProjectColor("red"), undefined);
  assert.equal(normalizeProjectColor(42), undefined);
  assert.equal(normalizeProjectColor(undefined), undefined);
});

test("an explicit project color wins over the automatic assignment", () => {
  assert.deepEqual(resolveProjectColor("/work/api", "#E07AB5", new Set()), {
    color: "#e07ab5",
    auto: false,
  });
  const invalid = resolveProjectColor("/work/api", "teal", new Set());
  assert.equal(invalid.auto, true);
  assert.ok(paletteHexes.includes(invalid.color));
});

test("automatic assignment is stable for one project path", () => {
  const first = resolveProjectColor("/work/api", undefined, new Set());
  const second = resolveProjectColor("/work/api", undefined, new Set());
  assert.equal(first.auto, true);
  assert.equal(first.color, second.color);
  assert.ok(paletteHexes.includes(first.color));
  // Separator style and a trailing slash describe the same folder.
  assert.equal(
    resolveProjectColor("C:\\work\\api\\", undefined, new Set()).color,
    resolveProjectColor("C:/work/api", undefined, new Set()).color,
  );
});

test("automatic assignment keeps its hash slot when it is free", () => {
  const slot = resolveProjectColor("/work/api", undefined, new Set()).color;
  const others = new Set(paletteHexes.filter((hex) => hex !== slot));
  assert.equal(resolveProjectColor("/work/api", undefined, others).color, slot);
});

test("automatic assignment probes past colors other projects already use", () => {
  const slot = resolveProjectColor("/work/api", undefined, new Set()).color;
  const probed = resolveProjectColor("/work/api", undefined, new Set([slot]));
  assert.notEqual(probed.color, slot);
  assert.ok(paletteHexes.includes(probed.color));
  // Even a fully claimed palette still returns a palette color.
  const exhausted = resolveProjectColor("/work/api", undefined, new Set(paletteHexes));
  assert.ok(paletteHexes.includes(exhausted.color));
});

test("project color survives the sidebar preferences roundtrip", () => {
  withMemoryLocalStorage(() => {
    saveSidebarPreferences({
      sessionMeta: {},
      projectMeta: {
        "/work/api": { color: "#5B9DFF" },
        "/work/bad": { color: "teal" },
      },
      projectSort: "recent",
      sessionView: { sort: "recent", archived: false },
      openProjectPaths: [],
    });
    const loaded = loadSidebarPreferences();
    assert.deepEqual(loaded.projectMeta["/work/api"], { color: "#5b9dff" });
    assert.equal("/work/bad" in loaded.projectMeta, false);
  });
});

test("project color actions persist explicit choices and never overwrite them", () => {
  const setColorBlock =
    projectSliceSource.match(/setProjectColor: \(path, color\) => \{[\s\S]*?\n    \},\n/)?.[0] ??
    "";
  assert.match(setColorBlock, /normalizeProjectColor\(color\)/);
  assert.match(setColorBlock, /delete meta\.color/);
  assert.match(setColorBlock, /persistCurrentSidebar\(get\)/);

  const applyBlock =
    projectSliceSource.match(/applyProjectColors: \(colors\) => \{[\s\S]*?\n    \},\n/)?.[0] ??
    "";
  assert.match(applyBlock, /if \(get\(\)\.projectMeta\[key\]\?\.color\) continue/);
  assert.match(applyBlock, /persistCurrentSidebar\(get\)/);
});

test("sidebar resolves one color per project and persists the automatic ones", () => {
  assert.match(
    sidebarSource,
    /resolveProjectColor\(entry\.key, entry\.meta\.color, used\)/,
  );
  assert.match(sidebarSource, /applyProjectColors\(projectColors\.auto\)/);
  assert.match(sidebarSource, /style=\{projectColorStyle\(projectColors\.byKey\.get\(entry\.key\)\)\}/);
  assert.match(sidebarSource, /data-project-color=/);
  // Globally pinned rows carry the owning project's color; temporary rows do not.
  assert.match(sidebarSource, /options\?\.global && normalizedProjectPath[\s\S]*?projectColors\.byKey\.get/);
  assert.match(sidebarSource, /rowColor \? "colored" : ""/);
});

test("project color popover edits, resets, and dismisses like other menus", () => {
  const colorMenuBlock =
    sidebarSource.match(/if \(colorMenu\) \{[\s\S]*?\n    \}\n/)?.[0] ?? "";
  assert.match(colorMenuBlock, /data-sidebar-color-menu=\{colorMenu\}/);
  assert.match(colorMenuBlock, /PROJECT_COLOR_PALETTE\.map/);
  assert.match(colorMenuBlock, /setProjectColor\(colorMenu, option\.hex\)/);
  assert.match(colorMenuBlock, /normalizeProjectColor\(next\)/);
  assert.match(colorMenuBlock, /setProjectColor\(colorMenu, null\)/);
  assert.match(colorMenuBlock, /onKeyDown=\{onMenuKeyDown\}/);
});

test("project color styles keep the drop target accent and follow the theme", () => {
  assert.match(threadsCss, /\.thread-item\.colored:hover \{/);
  assert.match(threadsCss, /\.sidebar-session-group\.project-group \.thread-item\.active \{/);
  assert.match(
    threadsCss,
    /\.sidebar-session-group\.project-group:not\(\.is-drop-target\)[^{]*:hover/,
  );
  assert.equal((tokensCss.match(/--ds-project-tint:/g) ?? []).length, 2);
  assert.equal((tokensCss.match(/--ds-project-tint-hover:/g) ?? []).length, 2);
  assert.equal((tokensCss.match(/--ds-project-tint-active:/g) ?? []).length, 2);
});
