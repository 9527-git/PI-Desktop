import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import type { ModelBinding, ModelInfo, ProviderPublic, ProviderUpdateInput } from "@pi-desktop/shared";
import { ProviderSetupDialog } from "../../apps/desktop/src/components/settings/ProviderSetupDialog";
import { api } from "../../apps/desktop/src/lib/api";

export function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
export const initial: ModelBinding[] = [
  { id: "Saved/ONE", alias: "First alias", contextWindow: 131072, maxTokens: 8192,
    thinkingLevels: ["off", "high"], defaultThinkingLevel: "high", supportsImages: true },
  { id: "saved/two", alias: "Second alias", contextWindow: 64000, maxTokens: 4096,
    thinkingLevels: ["off"], defaultThinkingLevel: "off", availableForSubagents: false },
];
const provider: ProviderPublic = {
  id: "selection-fixture", name: "Selection fixture", vendorKey: "custom",
  type: "openai_compatible", protocol: "openai_compatible", enabled: true,
  authKind: "api_key_and_base_url", apiStyle: "chat_completions",
  baseUrl: "https://fixture.invalid/v1", hasSecret: true, supportsReasoning: true,
  supportedThinkingLevels: ["off", "high"], createdAt: "", updatedAt: "", models: initial,
};
const discoveries: ModelInfo[] = ["saved/one", "saved/two", "new/three"].map((id) => ({
  modelId: id, displayName: `Published ${id}`, providerId: provider.id,
  contextWindow: 128000, maxTokens: 8192, capabilities: ["text"], source: "discovered",
}));
const i18n = createInstance();
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
let key = 0;
const updates: ProviderUpdateInput[] = [];
let releaseSave: (() => void) | undefined;
let holdSave = false;
const originalApi = { listProviderModels: api.listProviderModels, updateProvider: api.updateProvider };

export function element<T extends HTMLElement>(selector: string, scope: ParentNode = document): T {
  const found = scope.querySelector<T>(selector);
  assert(found, `missing ${selector}`);
  return found;
}
export function leftRow(id: string) {
  const row = [...document.querySelectorAll<HTMLElement>(".provider-models-row")].find((row) =>
    element(".provider-models-row-id", row).textContent?.toLowerCase() === id.toLowerCase());
  assert(row, `missing discovered model ${id}`);
  return row;
}
export function chosenRow(id: string) {
  const row = [...document.querySelectorAll<HTMLElement>(".provider-chosen-row")].find((row) =>
    element(".provider-chosen-row-id", row).textContent === id);
  assert(row, `missing configured model ${id}`);
  return row;
}
export function click(target: HTMLElement, detail = 0) {
  flushSync(() => detail ? target.dispatchEvent(new MouseEvent("click", {
    bubbles: true, cancelable: true, detail,
  })) : target.click());
}
export function search(value: string, selector = ".provider-chosen-search") {
  const input = element<HTMLInputElement>(selector);
  flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
export function verify(ids = initial.map((model) => model.id)) {
  assert(element(".provider-chosen-count").textContent === String(ids.length), "model count changed");
  for (const info of discoveries) {
    const expected = ids.some((id) => id.toLowerCase() === info.modelId.toLowerCase());
    assert(element<HTMLInputElement>("input", leftRow(info.modelId)).checked === expected,
      `wrong selection for ${info.modelId}`);
  }
}
export async function setup(locale = "en", models = initial) {
  if (!i18n.isInitialized) await i18n.init({ lng: locale, resources: {
    en: { translation: catalogs.en }, "zh-CN": { translation: catalogs["zh-CN"] },
  }, interpolation: { escapeValue: false } });
  await i18n.changeLanguage(locale);
  api.listProviderModels = async () => ({ models: discoveries, source: "remote" });
  api.updateProvider = async (input) => {
    updates.push(structuredClone(input));
    if (holdSave) await new Promise<void>((resolve) => { releaseSave = resolve; });
    return { provider: { ...provider, ...input } };
  };
  updates.length = 0;
  flushSync(() => root.render(<I18nextProvider i18n={i18n}>
    <ProviderSetupDialog key={++key} provider={{ ...provider, models }}
      onClose={() => {}} onSaved={() => {}} />
  </I18nextProvider>));
  const deadline = Date.now() + 3000;
  while (document.querySelectorAll(".provider-models-row").length !== 3) {
    assert(Date.now() < deadline, "discovery did not populate the fixture");
    await pause();
  }
}
export async function save(expected: ModelBinding[]) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === i18n.t("settings.saveProvider"));
  assert(button && !button.disabled, "save button is unavailable");
  const previousCount = updates.length;
  click(button);
  await pause();
  const update = updates.at(-1);
  assert(updates.length === previousCount + 1, "save did not send exactly one update");
  assert(JSON.stringify(update?.models) === JSON.stringify(expected), "save changed model bindings");
  assert(update?.defaultModelId === expected[0]?.id, "save changed the default model");
  assert(!update?.secretValue, "selection rewrote the stored secret");
}
export function blockSave() { holdSave = true; }
export async function finishSave() { holdSave = false; releaseSave?.(); releaseSave = undefined; await pause(); }
export function dispose() {
  releaseSave?.();
  flushSync(() => root.unmount());
  host.remove();
  Object.assign(api, originalApi);
}
