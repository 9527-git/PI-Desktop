import "../../apps/desktop/src/styles/model-config.css";
import {
  assert, blockSave, chosenRow, click, dispose, element, finishSave, initial,
  leftRow, save, search, setup, verify,
} from "./provider-model-selection-fixture";

let keyboardActivated = false;
let pointerActivated = false;
const checkbox = (id = "saved/two") => element<HTMLInputElement>("input", leftRow(id));
const target = (kind: string) => kind === "checkbox" ? checkbox() : element<HTMLElement>(
  kind === "padding" ? ".provider-models-row-label" : `.provider-models-row-${kind}`,
  leftRow("saved/two"),
);
const probe = {
  setup,
  verifyCheckbox() { click(checkbox()); verify(); },
  point(kind: string) {
    const node = target(kind);
    pointerActivated = false;
    node.addEventListener("click", (event) => { pointerActivated = event.isTrusted; }, { once: true });
    node.scrollIntoView({ block: "center" });
    const rect = node.getBoundingClientRect();
    return { x: Math.round(kind === "padding" ? rect.right - 3 : rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2) };
  },
  focusCheckbox() {
    keyboardActivated = false;
    checkbox().focus();
    checkbox().addEventListener("click", (event) => { keyboardActivated = event.isTrusted; }, { once: true });
  },
  verifyKeyboard() {
    assert(keyboardActivated, "native Space did not activate the checkbox");
    probe.verifyNative();
  },
  verifyNative() {
    assert(pointerActivated, "native pointer did not activate the target");
    verify();
    assert(element(".provider-chosen-advanced-toggle", chosenRow("saved/two"))
      .getAttribute("aria-expanded") === "true", "selected model configuration did not open");
  },
  async run() {
    const scenarios: string[] = ["native-pointer-id-name-limits-padding-checkbox", "native-keyboard-space"];
    await save(initial);
    try {
      for (const locale of ["en", "zh-CN"]) {
        await setup(locale);
        for (const kind of ["id", "name", "limits", "padding", "checkbox"]) {
          for (const detail of [0, 1, 2]) {
            click(target(kind), detail);
            click(target(kind), detail);
            verify();
          }
        }
        await save(initial);
        scenarios.push(`${locale}:repeated-row-and-checkbox-activation-preserves-save`);

        search("First alias");
        click(target("padding"), 1);
        assert(element<HTMLInputElement>(".provider-chosen-search").value === "", "hidden config was not revealed");
        search("Second alias");
        click(checkbox());
        assert(element<HTMLInputElement>(".provider-chosen-search").value === "Second alias", "matching filter was cleared");
        verify();
        search("");
        scenarios.push(`${locale}:configured-search-reveal`);

        const selection = window.getSelection();
        assert(selection, "selection API unavailable");
        const range = document.createRange();
        range.selectNodeContents(element(".provider-models-row-id", leftRow("new/three")));
        selection.removeAllRanges(); selection.addRange(range);
        click(element(".provider-models-row-copy", leftRow("new/three")), 1);
        verify();
        assert(!selection.isCollapsed, "copy gesture lost its text selection");
        click(checkbox(), 1);
        verify();
        selection.removeAllRanges();
        scenarios.push(`${locale}:drag-copy-and-stale-selection`);

        search("First alias");
        const newLabel = element<HTMLElement>("label", leftRow("new/three"));
        click(newLabel, 1); click(newLabel, 1); click(checkbox("new/three"));
        const ids = [...initial.map((binding) => binding.id), "new/three"];
        verify(ids);
        assert(element<HTMLInputElement>(".provider-chosen-search").value === "", "new model was added out of view");
        click(element(".provider-chosen-remove", chosenRow("new/three")));
        verify();
        await save(initial);
        scenarios.push(`${locale}:new-model-add-is-idempotent-and-remove-is-explicit`);

        click(element(".provider-chosen-remove", chosenRow("saved/two")));
        verify([initial[0].id]);
        await save([initial[0]]);
        await setup(locale, [initial[0]]);
        verify([initial[0].id]);
        click(checkbox()); click(checkbox());
        verify();
        scenarios.push(`${locale}:explicit-removal-save-reopen-and-readd`);

        await setup(locale);
        for (const selected of [true, false]) {
          search("new/three", ".provider-models-search");
          click(element(".provider-models-select-all"));
          search("", ".provider-models-search");
          verify(selected ? [...initial.map((model) => model.id), "new/three"] : undefined);
        }
        await save(initial);
        scenarios.push(`${locale}:filtered-bulk-actions-preserve-hidden-bindings`);

        await setup(locale);
        blockSave();
        await save(initial);
        try {
          click(element("label", leftRow("new/three")), 1);
          click(element("label", leftRow("saved/two")));
          click(checkbox("new/three"));
          verify();
          assert(checkbox().disabled, "saving left the checkbox enabled");
        } finally { await finishSave(); }
        verify();
        scenarios.push(`${locale}:busy-state-does-not-mutate-selection`);
      }
      return { ok: true, scenarios, apiBoundary: "stubbed", hostPersistence: "not exercised", liveModel: "not exercised" };
    } finally { dispose(); }
  },
};

declare global { var providerModelSelectionProbe: typeof probe; }
globalThis.providerModelSelectionProbe = probe;
