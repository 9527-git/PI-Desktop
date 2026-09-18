/**
 * Contract tests for the model picker's activation and removal semantics.
 *
 * Left-pane activation splits in two since D441: the checkbox is a real toggle
 * (unchecking removes the binding but keeps the row listed, remembering the
 * parameters for this edit), while every other activation stays additive -
 * an absent model is added, an existing one opens its configuration. Deletion
 * is the chosen pane's explicit action and also hides the discovered row.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

const pickerSource = await read("../src/components/settings/ModelSelectionPanes.tsx");
const rowSource = await read("../src/components/settings/DiscoveredModelRow.tsx");
const setupSource = await read("../src/components/settings/ProviderSetupDialog.tsx");
const vendorDialogSource = await read("../src/components/settings/VendorAccountDialog.tsx");
const vendorAccountsSource = await read("../src/components/settings/VendorAccountsSection.tsx");
const hostCatalogSource = await read("../../../crates/host-core/src/providers/catalog.rs");
const hostModelSource = await read("../../../crates/host-core/src/providers/model.rs");

test("the discovered row is the extracted activation unit", () => {
  assert.match(pickerSource, /DiscoveredModelRow/);
  // The extracted component owns the row markup and the activation wiring.
  assert.match(rowSource, /provider-models-row-label/);
  assert.match(rowSource, /provider-models-row-copy selectable/);
});

test("a single discovered activation adds or opens, never removes", () => {
  // Row activation (text, name, limits, keyboard) routes through the
  // idempotent select helper over just the activated row.
  assert.match(pickerSource, /const selectModel = \(row: ModelRow\)/);
  assert.match(
    pickerSource,
    /applyVisibleModelSelection\(current, \[row\]\)/,
  );
  // An existing binding is found case-insensitively so a case variant opens the
  // stored binding instead of introducing a duplicate.
  assert.match(
    pickerSource,
    /models\.find\(\(entry\) => entry\.id\.toLowerCase\(\) === key\)/,
  );
  // The exact stored id is opened, and a filter hiding it is cleared.
  assert.match(pickerSource, /setExpandedModelId\(binding\.id\)/);
  assert.match(pickerSource, /keepAddedModelVisible\(\[binding\]\)/);
  // Saving blocks every mutation.
  assert.match(pickerSource, /const selectModel = \(row: ModelRow\) => \{\s*if \(busy\) return;/);
});

test("the row checkbox is a real toggle that remembers the removed binding", () => {
  // Unchecking removes the binding but keeps the row listed, remembering the
  // exact binding so re-checking within this editing session restores its
  // parameters (alias, limits, thinking levels) instead of catalog defaults.
  assert.match(pickerSource, /const \[remembered, setRemembered\] = useState<Map<string, ModelBinding>>/);
  assert.match(pickerSource, /const toggleModel = \(row: ModelRow, checked: boolean\)/);
  assert.match(pickerSource, /next\.set\(key, existing\)/);
  assert.match(pickerSource, /const restored = remembered\.get\(key\)/);
  assert.match(pickerSource, /next\.delete\(key\)/);
  // Checking re-opens the model's settings either way.
  assert.match(pickerSource, /setExpandedModelId\(binding\.id\)/);
  // Saving blocks the toggle.
  assert.match(pickerSource, /const toggleModel = \(row: ModelRow, checked: boolean\) => \{\s*if \(busy\) return;/);
});

test("an unchecked row stays listed in every discovery mode", () => {
  // In fallback mode (or for a hand-added model with no discovery at all) the
  // left list is built from the configured bindings alone, so the remembered
  // bindings must merge back into the displayed rows — otherwise an uncheck
  // deletes the row outright and select-all can never bring it back.
  assert.match(pickerSource, /const displayRows = useMemo<ModelRow\[\]>/);
  assert.match(pickerSource, /if \(remembered\.size === 0\) return rows;/);
  assert.match(pickerSource, /for \(const \[key, binding\] of remembered\)/);
  assert.match(pickerSource, /if \(listed\.has\(key\)\) continue;/);
  // The merged list feeds every view: the hidden filter, the search, the
  // chosen filter, and the fetch-error placeholder.
  assert.match(pickerSource, /hiddenSet\.size === 0\s*\?\s*displayRows/);
  assert.match(pickerSource, /hidesAddedBinding\(added, chosenQuery, displayRows\)/);
  assert.match(pickerSource, /fetchFailed && displayRows\.length === 0/);
  // Re-checking a remembered row restores its exact parameters through the
  // toggle, from a checkbox or from a row activation.
  assert.match(
    pickerSource,
    /if \(!existing && remembered\.has\(key\)\) \{\s*toggleModel\(row, true\);/,
  );
  // Select-all re-adds remembered rows by their remembered binding, not by
  // catalog defaults, and its append is additive-only.
  assert.match(
    pickerSource,
    /remembered\.get\(row\.id\.toLowerCase\(\)\) \?\? bindingForRow\(row\)/,
  );
  assert.match(pickerSource, /added\.length === 0 \? current : \[\.\.\.current, \.\.\.added\]/);
});

test("deletion is explicit, destructive, and hides the discovered row", () => {
  // The chosen pane's Remove drops the binding, drops any remembered
  // parameters, and hides the discovered row so a deleted model does not
  // reappear from a service that still advertises it.
  assert.match(pickerSource, /const deleteModel = \(binding: ModelBinding\)/);
  assert.match(pickerSource, /next\.delete\(key\)/);
  assert.match(
    pickerSource,
    /onHiddenModelsChange\?\.\(\[\.\.\.\(hiddenModels \?\? \[\]\), binding\.id\]\)/,
  );
  // The restore entry lives under the list and clears the whole hidden set.
  assert.match(pickerSource, /provider-models-hidden/);
  assert.match(pickerSource, /const showHiddenModels = \(\) => onHiddenModelsChange\?\.\(\[\]\)/);
  // Re-adding a hidden id by hand unhides it.
  assert.match(
    pickerSource,
    /hiddenSet\.has\(id\.toLowerCase\(\)\)[\s\S]{0,200}hidden\.toLowerCase\(\) !== id\.toLowerCase\(\)/,
  );
  // The bulk header helper is additive-only, so it can never drop bindings.
  assert.match(pickerSource, /added\.length === 0 \? current : \[\.\.\.current, \.\.\.added\]/);
});

test("the hidden list persists with the provider record", () => {
  // Both credential kinds plumb the same hidden set into the picker and save
  // it alongside the bindings.
  for (const source of [setupSource, vendorDialogSource]) {
    assert.match(source, /hiddenModels=\{hiddenModels\}/);
    assert.match(source, /onHiddenModelsChange=/);
  }
  assert.match(setupSource, /hiddenModels,/);
  assert.match(vendorAccountsSource, /hiddenModels: form\.hiddenModels/);
  // Host-core stores the set in the provider config JSON and echoes it back.
  assert.match(hostModelSource, /pub hidden_models: Vec<String>/);
  assert.match(hostModelSource, /pub hidden_models: Option<Vec<String>>/);
  assert.match(hostCatalogSource, /fn config_hidden_models/);
  assert.match(hostCatalogSource, /fn config_with_hidden_models/);
});

test("every row activation path resolves to select or toggle, never both", () => {
  // The checkbox is controlled by the binding state and reports a real toggle.
  assert.match(rowSource, /checked=\{chosen\}/);
  assert.match(rowSource, /disabled=\{busy\}/);
  assert.match(rowSource, /onChange=\{\(event\) => onToggle\(event\.target\.checked\)\}/);
  assert.match(rowSource, /aria-label=\{row\.id\}/);
  // A click on the checkbox never double-fires the label handler.
  assert.match(rowSource, /if \(event\.target instanceof HTMLInputElement\) return;/);
  // Any other click cancels the label's native forwarding, then guards saving
  // and a real row-contained copy selection before selecting additively.
  assert.match(
    rowSource,
    /event\.preventDefault\(\);\s*if \(busy\) return;[\s\S]*?label\.contains\(selection\.anchorNode\)[\s\S]*?onSelect\(\);/,
  );
  // The obsolete detail-0 removal toggle is gone.
  assert.doesNotMatch(rowSource, /event\.detail === 0/);
});

test("the header select-all never clears, so the fallback list stays intact", () => {
  // The checkbox stays visible everywhere, but it only adds: unchecking is a
  // no-op, so a fallback list (exactly the configured models) can never be
  // bulk-wiped by the control that caused the regression.
  assert.match(pickerSource, /visibleRows\.length > 0 \? \(/);
  assert.doesNotMatch(
    pickerSource,
    /discovery\.source !== "fallback" \?[\s\S]{0,200}select-all/,
  );
  assert.match(pickerSource, /if \(event\.target\.checked\) selectAllVisibleModels\(\)/);
  // The removal branch is gone from the shared helper entirely.
  assert.doesNotMatch(pickerSource, /current\.filter\(\(binding\) => !visibleIds\.has/);
});
