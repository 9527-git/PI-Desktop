/**
 * Contract tests for the additive single-model activation in the shared picker.
 *
 * Left-pane activation is a selection, never a removal: an absent model is
 * added, an existing one opens its configuration. These pin the wiring the
 * regression exercised, separately from the broader discovery contract, so the
 * behavior stays readable without growing the main provider-model-config suite.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

const pickerSource = await read("../src/components/settings/ModelSelectionPanes.tsx");
const rowSource = await read("../src/components/settings/DiscoveredModelRow.tsx");

test("the discovered row is the extracted additive-activation unit", () => {
  assert.match(pickerSource, /DiscoveredModelRow/);
  // The extracted component owns the row markup and the activation wiring.
  assert.match(rowSource, /provider-models-row-label/);
  assert.match(rowSource, /provider-models-row-copy selectable/);
});

test("a single discovered activation adds or opens, never removes", () => {
  // The destructive toggle is gone; selection routes through the idempotent
  // select helper with `select: true` over just the activated row.
  assert.doesNotMatch(pickerSource, /toggleModel/);
  assert.match(pickerSource, /const selectModel = \(row: ModelRow\)/);
  assert.match(
    pickerSource,
    /applyVisibleModelSelection\(current, \[row\], true\)/,
  );
  // An existing binding is found case-insensitively so a case variant opens the
  // stored binding instead of introducing a duplicate.
  assert.match(
    pickerSource,
    /entry\.id\.toLowerCase\(\) === row\.id\.toLowerCase\(\)/,
  );
  // The exact stored id is opened, and a filter hiding it is cleared.
  assert.match(pickerSource, /setExpandedModelId\(binding\.id\)/);
  assert.match(pickerSource, /keepAddedModelVisible\(\[binding\]\)/);
  // Saving blocks every mutation.
  assert.match(pickerSource, /const selectModel = \(row: ModelRow\) => \{\s*if \(busy\) return;/);
});

test("removal stays an explicit action in the chosen pane", () => {
  // Only the right-pane Remove control drops a binding.
  assert.match(pickerSource, /entry\.id !== binding\.id/);
  // The bulk header control keeps its own scope, unchanged by single activation.
  assert.match(pickerSource, /applyVisibleModelSelection\(current, visibleRows, select\)/);
});

test("every row activation path resolves to the one additive select", () => {
  // The checkbox is controlled by the binding state and reports the same select.
  assert.match(rowSource, /checked=\{chosen\}/);
  assert.match(rowSource, /disabled=\{busy\}/);
  assert.match(rowSource, /onChange=\{onSelect\}/);
  assert.match(rowSource, /aria-label=\{row\.id\}/);
  // A click on the checkbox never double-fires the label handler.
  assert.match(rowSource, /if \(event\.target instanceof HTMLInputElement\) return;/);
  // Any other click cancels the label's native forwarding, then guards saving
  // and a real row-contained copy selection before selecting.
  assert.match(
    rowSource,
    /event\.preventDefault\(\);\s*if \(busy\) return;[\s\S]*?label\.contains\(selection\.anchorNode\)[\s\S]*?onSelect\(\);/,
  );
  // The obsolete detail-0 removal toggle is gone.
  assert.doesNotMatch(rowSource, /event\.detail === 0/);
});

test("the fallback list never offers the bulk clear", () => {
  // Fallback rows are the configured models themselves, so an all-selected
  // header checkbox could only wipe bindings the live answer may never offer
  // again - the control is hidden there instead of staying destructive.
  assert.match(
    pickerSource,
    /visibleRows\.length > 0 && discovery\.source !== "fallback"/,
  );
});
