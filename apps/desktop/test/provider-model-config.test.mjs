/**
 * Contract tests for discovery-first model configuration.
 *
 * The catalog-browsing redesign was rejected: a bundled list of thousands of
 * models is not a useful entry point, and a three-stage wizard is too many
 * clicks. The flow these tests pin is: one form takes the base URL and key, the
 * AI service is asked which models it serves, models.dev only enriches what
 * came back, and the user picks from that live list.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

const setupSource = await read("../src/components/settings/ProviderSetupDialog.tsx");
const hookSource = await read("../src/components/settings/useProviderModels.ts");
const pageSource = await read("../src/components/settings/ModelConfigPage.tsx");
const vendorDialogSource = await read("../src/components/settings/VendorAccountDialog.tsx");
const pickerSource = await read("../src/components/settings/ModelSelectionPanes.tsx");
// The picker's left pane, its header and its rows are modules of their own.
const listSource = await read("../src/components/settings/ProviderModelList.tsx");
const listHeadSource = await read("../src/components/settings/ProviderModelListHead.tsx");
const rowSource = await read("../src/components/settings/ProviderModelRow.tsx");
const vendorAccountsSource = await read("../src/components/settings/VendorAccountsSection.tsx");
const apiSource = await read("../src/lib/api.ts");
const catalogContractSource = await read("../../../packages/shared/src/model-catalog.ts");
const styles = await loadStyles();

test("the model list comes from the AI service, not from a browsable catalog", () => {
  assert.match(hookSource, /api\.listProviderModels\(/);
  // The rejected surface and its host-side search must be gone.
  assert.doesNotMatch(setupSource, /ModelCatalogBrowser/);
  assert.doesNotMatch(vendorDialogSource, /ModelCatalogBrowser/);
  assert.doesNotMatch(apiSource, /searchCatalogModels/);
  assert.doesNotMatch(setupSource, /searchCatalogModels/);
});

test("adding an AI service is a single form, not a staged wizard", () => {
  assert.doesNotMatch(setupSource, /STAGES/);
  assert.doesNotMatch(setupSource, /provider-setup-stepper/);
  assert.doesNotMatch(setupSource, /provider-preset-grid/);
  assert.doesNotMatch(setupSource, /settings\.setupStage/);
  assert.doesNotMatch(setupSource, /settings\.next"/);
  // Name, base URL and key are all reachable without navigating a step.
  assert.match(setupSource, /settings\.name/);
  assert.match(setupSource, /settings\.baseUrl/);
  assert.match(setupSource, /settings\.apiKey/);
  assert.match(setupSource, /settings\.saveProvider/);
});

test("discovery is debounced, race-guarded and survives a bad URL", () => {
  assert.match(hookSource, /FETCH_DEBOUNCE_MS/);
  assert.match(hookSource, /requestSeq/);
  assert.match(hookSource, /new URL\(/);
  assert.match(hookSource, /clearTimeout/);
  // A local or no-auth gateway must still be probed, so a key is not required.
  assert.doesNotMatch(hookSource, /apiKey\.trim\(\)\.length > 0/);
});

test("an unsaved provider can be probed before it is persisted", () => {
  // baseUrl + apiKey with no providerId is what the host treats as a raw probe.
  assert.match(hookSource, /baseUrl/);
  assert.match(hookSource, /apiKey/);
  assert.match(
    apiSource,
    /listProviderModels: \(input: \{[\s\S]*?providerId\?: string;[\s\S]*?baseUrl\?: string;[\s\S]*?apiKey\?: string;/,
  );
});

test("editing paints the cached list first, then replaces it with a live answer", () => {
  assert.match(hookSource, /source: "cache"/);
  // The live call omits `source` entirely; that is what selects the live branch.
  assert.match(hookSource, /status: "error"/);
  assert.match(hookSource, /cachedModels/);
});

test("the renderer can tell a catalog fallback from the service's own answer", () => {
  assert.match(apiSource, /"cache" \| "remote" \| "catalog" \| "fallback"/);
  assert.match(hookSource, /source/);
});

test("token limits are adopted from the published record, never typed by default", () => {
  assert.match(catalogContractSource, /export function bindingFromModelInfo/);
  assert.match(catalogContractSource, /CATALOG_DEFAULT_CONTEXT_WINDOW/);
  assert.match(catalogContractSource, /CATALOG_DEFAULT_MAX_TOKENS/);
  // Both dialogs adopt them through the one shared picker (D269).
  assert.match(pickerSource, /bindingFromModelInfo\(/);
  // Numeric overrides stay behind the per-row disclosure.
  assert.match(pickerSource, /expandedModelId/);
});

test("custom API format is a common-path choice, named services skip it", () => {
  assert.match(setupSource, /settings\.apiStyle/);
  assert.match(setupSource, /API_STYLES/);
  assert.match(setupSource, /custom \? \(/);
  assert.match(setupSource, /provider-advanced-dialog/);
  assert.doesNotMatch(setupSource, /provider-setup-advanced-toggle/);
});

test("editing a provider with an unknown persisted API style stays renderable", () => {
  assert.match(setupSource, /normalizeApiStyle\(provider\?\.apiStyle\)/);
  assert.match(setupSource, /default:\s*return \["\/chat\/completions", "\/models"\]/);
});

test("both credential kinds share one live list and one binding shape", () => {
  assert.match(setupSource, /useProviderModels/);
  assert.match(vendorDialogSource, /useProviderModels/);
  assert.match(vendorDialogSource, /models: ModelBinding\[\]/);
  // The account's default model is still the head binding, taken from the
  // narrowed list the picker hands back rather than from raw state.
  assert.match(vendorDialogSource, /modelId: persisted\[0\]\.id/);
  assert.match(vendorAccountsSource, /models: form\.models/);
  assert.doesNotMatch(vendorAccountsSource, /source: _source/);
});

test("one picker component serves the service dialog and the account dialog", () => {
  // The two surfaces were copies, and the copy lost the advanced controls.
  // Neither dialog may grow its own picker back.
  for (const source of [setupSource, vendorDialogSource]) {
    assert.match(source, /ModelSelectionPanes/);
    assert.match(source, /useModelSelection\(/);
    assert.doesNotMatch(source, /provider-models-list/);
    assert.doesNotMatch(source, /provider-chosen-list/);
    assert.doesNotMatch(source, /visibleRows/);
    assert.doesNotMatch(source, /addCustomModel/);
    assert.doesNotMatch(source, /toggleModel/);
    assert.doesNotMatch(source, /applyVisibleModelSelection/);
    assert.doesNotMatch(source, /selectAllVisibleModels/);
    assert.doesNotMatch(source, /fetchModelList/);
    assert.match(source, /onReload=\{discovery\.reload\}/);
  }
  // Only the heading of the discovered list differs between them.
  assert.match(setupSource, /listTitle=\{t\("settings\.serviceModels"\)\}/);
  assert.match(vendorDialogSource, /listTitle=\{t\("settings\.accountModels"\)\}/);
});

test("a header action probes the live list without waiting for debounce", () => {
  assert.match(hookSource, /reload: \(\) => void/);
  assert.match(hookSource, /skipCache: true/);
  assert.match(hookSource, /skipCache \? modelsRef\.current/);
  assert.match(hookSource, /canReload/);
  // Idle-with-a-valid-URL (the edit debounce) must still be reloadable.
  assert.match(hookSource, /status !== "loading"/);
  assert.match(listHeadSource, /disabled=\{busy \|\| !canReload\}/);
  assert.doesNotMatch(
    pickerSource,
    /discovery\.status === "idle" \|\| discovery\.status === "loading"/,
  );
  // The automatic path still waits; only the header action skips the window.
  assert.match(hookSource, /FETCH_DEBOUNCE_MS/);
  assert.match(listHeadSource, /settings\.fetchModelList/);
  assert.match(listHeadSource, /provider-models-reload/);
  assert.match(pickerSource, /onReload=\{onReload\}/);
  assert.doesNotMatch(pickerSource, /provider-models-state/);
});

test("the shared picker can select or clear every visible model at once", () => {
  assert.match(pickerSource, /export function applyVisibleModelSelection/);
  assert.match(listHeadSource, /provider-models-select-all/);
  assert.match(pickerSource, /toggleVisibleModels/);
  assert.match(listHeadSource, /settings\.selectAllVisibleModels/);
  assert.match(listHeadSource, /settings\.deselectAllVisibleModels/);
  assert.match(listHeadSource, /el\.indeterminate/);
  // A filtered select-all must not drop models the filter is hiding.
  assert.match(pickerSource, /a filtered select-all does not touch hidden matches/);
  assert.match(listHeadSource, /visibleCount > 0/);
});

test("the shared picker owns the advanced per-model controls for both kinds", () => {
  assert.match(pickerSource, /provider-chosen-advanced-toggle/);
  assert.match(pickerSource, /settings\.contextWindow/);
  assert.match(pickerSource, /settings\.maxOutput/);
  assert.match(pickerSource, /provider-chosen-thinking-chips/);
  assert.match(pickerSource, /publishedThinkingLevels/);
  assert.match(pickerSource, /bindingsToPersist/);
});

test("a vendor account saves explicit bindings, not raw state", () => {
  // The shared picker preserves explicit thinking levels, including a manual
  // override not present in the catalog.
  assert.match(vendorDialogSource, /selection\.bindingsToPersist/);
  assert.match(vendorDialogSource, /models: persisted/);
  assert.doesNotMatch(vendorDialogSource, /models: models \}/);
});

test("model ids are matched case-insensitively across picking and hand entry", () => {
  // One picker, so one matching rule for both credential kinds.
  assert.match(pickerSource, /toLowerCase\(\)/);
  assert.match(pickerSource, /bindingForCustomModel\(/);
  assert.match(pickerSource, /settings\.modelAlreadyAdded/);
});

test("default model selection saves the exact model and provider", () => {
  // The settings picker is model-level; provider rows still use their first
  // model as a convenience action.
  assert.match(pageSource, /const setDefaultModel = async \(provider: ProviderPublic, modelId: string\)/);
  assert.match(pageSource, /defaultProviderId: provider.id,[\s\S]*defaultModelId: modelId/);
  assert.match(pageSource, /onClick=\{\(\) => void setDefaultModel\(provider, modelId\)\}/);
  assert.match(pageSource, /visibleDefaultModelOptions\.map/);
  assert.match(pageSource, /provider\.id === settings\.defaultProviderId &&[\s\S]*modelIdsMatch/);
  assert.match(pageSource, /defaultModelId: firstModelId \?\? ""/);
  assert.match(
    pageSource,
    /settings\.defaultProviderId === saved\.id && firstModelId[\s\S]*defaultModelId: firstModelId/,
  );
  // The summary line must go through the ownership-aware resolver.
  assert.match(pageSource, /displayedDefaultModelId\(/);
  assert.doesNotMatch(pageSource, /\{settings\.defaultModelId \|\|/);
});

test("the rejected catalog-browser styles are gone from the cascade", () => {
  assert.doesNotMatch(styles, /\.model-catalog-panes\s*\{/);
  assert.doesNotMatch(styles, /\.model-catalog-filter\s*\{/);
  assert.doesNotMatch(styles, /\.provider-setup-stepper\s*\{/);
  assert.doesNotMatch(styles, /\.provider-preset-card\s*\{/);
  // Only the dialog body scrolls, so the action bar stays reachable.
  assert.match(styles, /\.provider-setup-body\s*\{[\s\S]*?overflow-y: auto;/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("model ids are copyable and a configured model can carry an alias", () => {
  // The shell is non-selectable, so the id/name text opts back in.
  assert.match(rowSource, /provider-models-row-copy selectable/);
  assert.match(pickerSource, /provider-chosen-row-id font-mono selectable/);
  // A drag-selection inside the row is a copy gesture, not a checkbox toggle.
  // The guard is row-scoped, so a stale selection elsewhere on the page cannot
  // cancel a plain click or the Space key's synthetic click.
  assert.match(rowSource, /selection\.isCollapsed/);
  assert.match(rowSource, /label\.contains\(selection\.anchorNode\)/);
  assert.match(rowSource, /label\.contains\(selection\.focusNode\)/);
  // Keyboard activation reports detail 0 and must still toggle.
  assert.match(rowSource, /event\.detail === 0/);
  // A selection left behind by copying must not block an explicit checkbox click.
  assert.match(rowSource, /event\.target instanceof HTMLInputElement/);
  assert.match(rowSource, /event\.preventDefault\(\)/);
  for (const source of [pickerSource, listSource, listHeadSource, rowSource]) {
    assert.doesNotMatch(source, /window\.getSelection\(\)\?\.toString\(\)/);
  }
  // The alias is edited in the Advanced body and shown beside the id.
  assert.match(pickerSource, /settings\.modelAlias/);
  assert.match(pickerSource, /updateBinding\(binding\.id, \{/);
  // The 60-character cap counts Unicode scalars, matching host-core.
  assert.match(pickerSource, /\[\.\.\.event\.target\.value\]\.slice\(0, 60\)/);
  assert.match(pickerSource, /provider-chosen-row-alias/);
  assert.match(styles, /\.provider-chosen-row-alias\s*\{/);
});

test("a click outside the checkbox never drops the model", () => {
  // The row label owns the click for the whole row: it cancels the label's
  // native checkbox activation, so the pointer cursor over the row's padding,
  // id, name, or limits cell never removes the model.
  const rowClick = rowSource.slice(rowSource.indexOf("provider-models-row-label"));
  assert.match(rowClick, /event\.preventDefault\(\);\s*if \(busy\) return;/);
  // A configured row opens its settings; an unconfigured one is picked. Only
  // the checkbox removes.
  assert.match(rowClick, /if \(chosen\) onReveal\(\);/);
  assert.match(rowClick, /else onToggle\(\);/);
  assert.match(rowClick, /if \(busy\) return;/);
  // The checkbox stays the one control that picks or drops the model.
  assert.match(rowSource, /onChange=\{onToggle\}/);
  // A drag-copy that happens to end inside the text stays a copy, and the
  // keyboard's synthetic click keeps toggling.
  assert.match(rowClick, /selection\.isCollapsed/);
  assert.match(rowSource, /event\.detail === 0/);

  // The picker answers by opening the configured binding and scrolling to it.
  assert.match(pickerSource, /const revealModelConfig = \(row: ModelRow\)/);
  assert.match(
    pickerSource,
    /models\.find\(\(entry\) => entry\.id\.toLowerCase\(\) === key\)/,
  );
  // A model that is not configured yet has nothing to open.
  assert.match(pickerSource, /if \(!binding\) return;/);
  assert.match(pickerSource, /setExpandedModelId\(binding\.id\)/);
  assert.match(pickerSource, /scrollIntoView\(\{ block: "nearest"/);
  assert.match(pickerSource, /onReveal=\{revealModelConfig\}/);
  // The mark it leaves is transient and respects reduced motion.
  assert.match(pickerSource, /REVEAL_HIGHLIGHT_MS/);
  assert.match(pickerSource, /revealedId === binding\.id\.toLowerCase\(\) && "is-revealed"/);
  assert.match(pickerSource, /window\.matchMedia/);
  assert.match(styles, /\.provider-chosen-row\.is-revealed\s*\{/);
  assert.match(styles, /prefers-reduced-motion[\s\S]{0,200}\.provider-chosen-row\.is-revealed/);
  // The name advertises itself as text rather than as the row's toggle.
  assert.match(styles, /\.provider-models-row-copy\s*\{[\s\S]*?cursor: text;/);
});
