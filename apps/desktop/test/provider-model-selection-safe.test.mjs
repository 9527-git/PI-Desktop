/**
 * Contract tests for the model picker's activation and removal semantics.
 *
 * Left-pane activation splits in two since D441: the checkbox is a real toggle
 * (unchecking removes the binding but keeps the row listed, remembering the
 * parameters — persisted with the provider record since D442), while every
 * other activation stays additive - an absent model is added, an existing one
 * opens its configuration. The header select-all became a real toggle too
 * since D443 - the persisted memory made its old add-only guard unnecessary.
 * Deletion is the chosen pane's explicit action and also hides the discovered
 * row.
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
const hostRepositorySource = await read("../../../crates/host-core/src/providers/repository.rs");

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
  // exact binding so re-checking restores its parameters (alias, limits,
  // thinking levels) instead of catalog defaults.
  assert.match(pickerSource, /const \[remembered, setRemembered\] = useState<Map<string, ModelBinding>>/);
  assert.match(pickerSource, /const toggleModel = \(row: ModelRow, checked: boolean\)/);
  assert.match(pickerSource, /next\.set\(key, binding\)/);
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
  // The header add path is additive (the D443 clear path is a separate
  // function), so checking never drops a binding.
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

test("the unchecked set persists with the provider record", () => {
  // The picker seeds its memory from the provider record and reports every
  // change back, so an unchecked row keeps its parameters across a save and
  // reopen instead of silently vanishing in fallback mode.
  assert.match(pickerSource, /disabledModels\?: ModelBinding\[\]/);
  assert.match(pickerSource, /onDisabledModelsChange\?: \(next: ModelBinding\[\]\) => void/);
  assert.match(pickerSource, /for \(const binding of disabledModels \?\? \[\]\)/);
  assert.match(pickerSource, /onDisabledModelsChange\?\.\(\[\.\.\.next\.values\(\)\]\)/);
  // Uncheck, re-check, and delete all keep the persisted set in step.
  assert.match(pickerSource, /const removeFromRemembered = \(key: string\)/);
  assert.match(pickerSource, /const addToRemembered = \(key: string, binding: ModelBinding\)/);
  // Both credential kinds plumb the same unchecked set into the picker and
  // save it alongside the bindings.
  for (const source of [setupSource, vendorDialogSource]) {
    assert.match(source, /disabledModels=\{disabledModels\}/);
    assert.match(source, /onDisabledModelsChange=/);
    assert.match(source, /\.disabledModels \?\? \[\]/);
    assert.match(source, /disabledModels,/);
  }
  assert.match(vendorDialogSource, /disabledModels: ModelBinding\[\]/);
  assert.match(vendorAccountsSource, /disabledModels: form\.disabledModels/);
  // Host-core stores the bindings in the provider config JSON and echoes them
  // back on the provider record.
  assert.match(hostModelSource, /pub disabled_models: Vec<ModelBinding>/);
  assert.match(hostModelSource, /pub disabled_models: Option<Vec<ModelBinding>>/);
  assert.match(hostCatalogSource, /fn config_disabled_models/);
  assert.match(hostCatalogSource, /fn config_with_disabled_models/);
  assert.match(hostRepositorySource, /disabled_models: config_disabled_models\(&config_raw\)/);
  assert.match(hostRepositorySource, /config_with_disabled_models\(&config_json, bindings\)/);
  assert.match(hostRepositorySource, /config_with_disabled_models\(/);
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

test("the header select-all toggles the visible rows without deleting them", () => {
  // The checkbox stays visible everywhere and now behaves like a checkbox
  // (D443): checking adds every visible row, unchecking removes them - but each
  // removed binding is remembered (persisted via disabledModels since D442) and
  // stays listed, so the fallback bulk-wipe that forced D440's add-only rule can
  // no longer lose a configured model.
  assert.match(pickerSource, /visibleRows\.length > 0 \? \(/);
  assert.match(
    pickerSource,
    /if \(event\.target\.checked\) selectAllVisibleModels\(\);\s*else clearAllVisibleModels\(\);/,
  );
  // The clear path is a real removal, not the old no-op.
  assert.match(pickerSource, /const clearAllVisibleModels = \(\) => \{/);
  // Each visible binding moves into the remembered set before it is dropped,
  // mirroring the row toggle so a re-check restores the saved parameters.
  assert.match(
    pickerSource,
    /for \(const binding of removed\) next\.set\(binding\.id\.toLowerCase\(\), binding\);/,
  );
  assert.match(pickerSource, /updateRemembered\(next\);/);
  assert.match(
    pickerSource,
    /current\.filter\(\(binding\) => !visibleKeys\.has\(binding\.id\.toLowerCase\(\)\)\)/,
  );
  // The obsolete add-only tooltip key is gone; the toggle hint replaces it.
  assert.doesNotMatch(pickerSource, /selectAllAddOnlyHint/);
  assert.match(pickerSource, /title=\{t\("settings\.selectAllModelsHint"\)\}/);
});
