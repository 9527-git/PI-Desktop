/**
 * The one model picker both credential kinds render.
 *
 * An AI service and a vendor account differ in how they authenticate, not in
 * what choosing a model means: the same discovered list, the same binding
 * shape, the same per-model limits and thinking levels. While each dialog kept
 * its own copy the account editor silently lost the advanced controls, so the
 * guarantee lives here once instead of in a convention two files had to
 * remember.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  THINKING_LEVELS,
  bindingForCustomModel,
  bindingFromModelInfo,
  formatTokenCount,
  modelMatchesFilter,
  publishedThinkingLevels,
  sortThinkingLevels,
  type ModelBinding,
  type ModelInfo,
  type ThinkingLevel,
} from "@pi-desktop/shared";
import { Button, Field, Input, Tooltip, TooltipButton, cx } from "../ui";
import { IconClose, IconHelp, IconPlus } from "../icons";
import { ProviderModelList } from "./ProviderModelList";
import type { ProviderModelsState } from "./useProviderModels";

/** How long the right pane marks the row the left list pointed at. */
const REVEAL_HIGHLIGHT_MS = 1600;

/** One row of the model list: what the service returned, plus its binding. */
export type ModelRow = {
  id: string;
  displayName: string;
  contextWindow?: number;
  maxTokens?: number;
  /** Published record when the service (or models.dev) described the model. */
  info?: ModelInfo;
  binding?: ModelBinding;
};

export type ModelSelection = {
  rows: ModelRow[];
  models: ModelBinding[];
  publishedLevelsById: Map<string, ThinkingLevel[]>;
  /**
   * What the caller must save: the chosen bindings with explicit thinking
   * selections preserved, including manual overrides not listed by the catalog.
   */
  bindingsToPersist: ModelBinding[];
  setModels: (update: (current: ModelBinding[]) => ModelBinding[]) => void;
};

/**
 * Row merging and published-level metadata for one binding list.
 *
 * Rows are the models the credential offered, plus any configured binding the
 * current answer does not mention (a hand-typed id, or an endpoint that went
 * quiet), so nothing already saved can silently disappear.
 */
export function useModelSelection(
  discovery: ProviderModelsState,
  models: ModelBinding[],
  setModels: (update: (current: ModelBinding[]) => ModelBinding[]) => void,
): ModelSelection {
  const rows = useMemo<ModelRow[]>(() => {
    const byId = new Map<string, ModelRow>();
    for (const model of discovery.models) {
      byId.set(model.modelId.toLowerCase(), {
        id: model.modelId,
        displayName: model.displayName,
        contextWindow: model.contextWindow ?? model.limit?.context,
        maxTokens: model.maxTokens ?? model.limit?.output,
        info: model,
      });
    }
    for (const binding of models) {
      const key = binding.id.toLowerCase();
      const existing = byId.get(key);
      if (existing) byId.set(key, { ...existing, binding });
      else {
        byId.set(key, {
          id: binding.id,
          displayName: binding.id,
          contextWindow: binding.contextWindow,
          maxTokens: binding.maxTokens,
          binding,
        });
      }
    }
    return [...byId.values()];
  }, [discovery.models, models]);

  /**
   * Published thinking levels are kept separately from the editable binding.
   * They seed newly added known models and explain the catalog baseline, but a
   * user may explicitly configure any canonical level for a proxy or new model.
   */
  const publishedLevelsById = useMemo(() => {
    const byId = new Map<string, ThinkingLevel[]>();
    for (const row of rows) {
      // A row with no published record is a hand-typed id, a vendor account
      // model the catalog does not list, or an endpoint that went quiet. Those
      // stay out of the map entirely: an absent entry means "unknown", which
      // preserves the stored levels, while an empty entry would erase them.
      if (!row.info) continue;
      byId.set(row.id.toLowerCase(), publishedThinkingLevels(row.info));
    }
    return byId;
  }, [rows]);

  /**
   * Persist the user's explicit level set. The catalog is metadata and a
   * provider endpoint may support a level that its published record omits.
   */
  const bindingsToPersist = useMemo(
    () =>
      models.map((binding) => {
        // Canonical order, because this is the same order the panel offers the
        // default in: picking the first entry of an insertion-ordered list here
        // would save a different default than the one the user was shown.
        const thinkingLevels = sortThinkingLevels(binding.thinkingLevels);
        const enabled = thinkingLevels;
        const defaultThinkingLevel =
          binding.defaultThinkingLevel && enabled.includes(binding.defaultThinkingLevel)
            ? binding.defaultThinkingLevel
            : (enabled[0] ?? null);
        if (
          thinkingLevels.length === binding.thinkingLevels.length &&
          defaultThinkingLevel === binding.defaultThinkingLevel
        ) {
          return binding;
        }
        return { ...binding, thinkingLevels, defaultThinkingLevel };
      }),
    [models],
  );

  return { rows, models, publishedLevelsById, bindingsToPersist, setModels };
}

/**
 * Add or drop every currently visible row in one step.
 *
 * The search box is a view over the live list, so "all" means the rows on
 * screen: a filtered select-all does not touch hidden matches, and a filtered
 * clear does not drop models that are still chosen off-screen. Already-chosen
 * bindings keep their advanced overrides.
 */
export function applyVisibleModelSelection(
  current: ModelBinding[],
  visibleRows: ModelRow[],
  select: boolean,
): ModelBinding[] {
  const visibleIds = new Set(visibleRows.map((row) => row.id.toLowerCase()));
  if (!select) {
    return current.filter((binding) => !visibleIds.has(binding.id.toLowerCase()));
  }
  const selected = new Set(current.map((binding) => binding.id.toLowerCase()));
  const additions: ModelBinding[] = [];
  for (const row of visibleRows) {
    if (selected.has(row.id.toLowerCase())) continue;
    additions.push(
      row.info ? bindingFromModelInfo(row.info) : bindingForCustomModel(row.id),
    );
  }
  return additions.length === 0 ? current : [...current, ...additions];
}

export type ModelSelectionPanesProps = {
  discovery: ProviderModelsState & { canReload?: boolean };
  selection: ModelSelection;
  /** Heading of the discovered list: a service's models, or an account's. */
  listTitle: string;
  /** True while the caller saves, so the picker stops accepting input. */
  busy?: boolean;
  /** Probe the service's model list now, skipping the edit debounce. */
  onReload?: () => void;
};

/**
 * Two panes, because picking a model and reviewing what was picked are one
 * task: the credential's list on the left, the chosen bindings on the right.
 * Stacking them made the dialog scroll for no reason.
 */
export function ModelSelectionPanes({
  discovery,
  selection,
  listTitle,
  busy = false,
  onReload,
}: ModelSelectionPanesProps) {
  const { t } = useTranslation();
  const { rows, models, publishedLevelsById, setModels } = selection;
  const [customModelId, setCustomModelId] = useState("");
  const [customModelError, setCustomModelError] = useState("");
  const [expandedModelId, setExpandedModelId] = useState<string | null>(
    () => models[0]?.id ?? null,
  );
  // The left list points into the right pane, so picking a configured model
  // by name opens its settings instead of dropping it. The row it opened is
  // marked for as long as the highlight runs.
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const chosenRowRefs = useRef(new Map<string, HTMLLIElement>());
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    [],
  );

  // Chosen ids drive the left list's checkbox states.
  const selected = useMemo(
    () => new Set(models.map((binding) => binding.id.toLowerCase())),
    [models],
  );

  // Published records for the chosen rows, so the capability switches can show
  // what models.dev says before the user overrides it.
  const infoById = useMemo(() => {
    const byId = new Map<string, ModelInfo>();
    for (const row of rows) if (row.info) byId.set(row.id.toLowerCase(), row.info);
    return byId;
  }, [rows]);

  const toggleModel = (row: ModelRow) => {
    const wanted = row.id.toLowerCase();
    const alreadyChosen = models.some(
      (binding) => binding.id.toLowerCase() === wanted,
    );
    if (!alreadyChosen) setExpandedModelId((open) => open ?? row.id);
    setModels((current) => {
      if (current.some((binding) => binding.id.toLowerCase() === wanted)) {
        return current.filter((binding) => binding.id.toLowerCase() !== wanted);
      }
      // A discovered row arrives already enriched, so its published limits and
      // thinking levels are adopted as-is.
      return [
        ...current,
        row.info ? bindingFromModelInfo(row.info) : bindingForCustomModel(row.id),
      ];
    });
  };

  const toggleVisibleModels = (visibleRows: ModelRow[], select: boolean) => {
    if (select) setExpandedModelId((open) => open ?? visibleRows[0]?.id ?? null);
    setModels((current) => applyVisibleModelSelection(current, visibleRows, select));
  };

  /**
   * A click on a configured model's name in the left list: open its settings
   * and bring the row into view. A model that is not configured yet has no
   * settings to show, so the checkbox stays the only way to pick it.
   */
  const revealModelConfig = (row: ModelRow) => {
    const key = row.id.toLowerCase();
    const binding = models.find((entry) => entry.id.toLowerCase() === key);
    if (!binding) return;
    setExpandedModelId(binding.id);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => setRevealedId(null), REVEAL_HIGHLIGHT_MS);
    const node = chosenRowRefs.current.get(key);
    if (!node) return;
    // The row is mounted already, so the mark and the scroll follow the
    // expansion in the next frame: by then the body it opened has settled the
    // row's height. Dropping the mark first lets a repeated click flash again.
    setRevealedId(null);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      if (!node.isConnected) return;
      setRevealedId(key);
      node.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    });
  };

  const updateBinding = (id: string, update: Partial<ModelBinding>) =>
    setModels((current) =>
      current.map((binding) => (binding.id === id ? { ...binding, ...update } : binding)),
    );

  const addCustomModel = () => {
    const id = customModelId.trim();
    if (!id) {
      setCustomModelError(t("settings.customModelRequired"));
      return;
    }
    if (models.some((binding) => binding.id.toLowerCase() === id.toLowerCase())) {
      setCustomModelError(t("settings.modelAlreadyAdded"));
      return;
    }
    setModels((current) => [...current, bindingForCustomModel(id)]);
    setExpandedModelId(id);
    setCustomModelId("");
    setCustomModelError("");
  };

  return (
    <div className="provider-setup-panes">
      <ProviderModelList
        discovery={discovery}
        listTitle={listTitle}
        busy={busy}
        rows={rows}
        selectedIds={selected}
        onToggle={toggleModel}
        onSelectVisible={toggleVisibleModels}
        onReveal={revealModelConfig}
        onReload={onReload}
      />

      <div className="provider-chosen">
        <div className="provider-chosen-head">
          <h4 className="provider-chosen-title">{t("settings.modelConfigurations")}</h4>
          <span className="provider-chosen-count">{models.length}</span>
        </div>
        {models.length === 0 ? (
          <div className="provider-chosen-empty">{t("settings.noModelsChosen")}</div>
        ) : (
          <ul className="provider-chosen-list">
            {models.map((binding) => {
              // The catalog is a baseline, not a capability gate. Always show
              // the canonical ladder so a proxy or newly released model can be
              // configured before models.dev catches up.
              const levelChoices = THINKING_LEVELS;
              const publishedLevels =
                publishedLevelsById.get(binding.id.toLowerCase()) ?? [];
              const enabledLevels = sortThinkingLevels(binding.thinkingLevels);
              const info = infoById.get(binding.id.toLowerCase());
              const publishedImages = info ? modelMatchesFilter(info, "vision") : false;
              const publishedDocuments = info ? modelMatchesFilter(info, "pdf") : false;
              const expanded = expandedModelId === binding.id;
              const advancedId = `model-advanced-${binding.id}`;
              return (
                <li
                  className={cx(
                    "provider-chosen-row",
                    revealedId === binding.id.toLowerCase() && "is-revealed",
                  )}
                  key={binding.id}
                  ref={(node) => {
                    const key = binding.id.toLowerCase();
                    if (node) chosenRowRefs.current.set(key, node);
                    else chosenRowRefs.current.delete(key);
                  }}
                >
                  <div className="provider-chosen-row-head">
                    <span className="provider-chosen-row-id font-mono selectable">
                      {binding.id}
                    </span>
                    {binding.alias?.trim() ? (
                      <span className="provider-chosen-row-alias">{binding.alias.trim()}</span>
                    ) : null}
                    <span className="provider-chosen-row-limits">
                      {formatTokenCount(binding.contextWindow)} ·{" "}
                      {formatTokenCount(binding.maxTokens)}
                    </span>
                    <button
                      type="button"
                      className="provider-chosen-advanced-toggle"
                      aria-expanded={expanded}
                      aria-controls={advancedId}
                      onClick={() =>
                        setExpandedModelId((current) =>
                          current === binding.id ? null : binding.id,
                        )
                      }
                    >
                      {t("settings.advanced")}
                    </button>
                    <TooltipButton
                      type="button"
                      className="provider-chosen-remove"
                      ariaLabel={t("settings.removeModel")}
                      tooltip={t("settings.removeModel")}
                      disabled={busy}
                      onClick={() =>
                        setModels((current) =>
                          current.filter((entry) => entry.id !== binding.id),
                        )
                      }
                    >
                      <IconClose size={12} />
                    </TooltipButton>
                  </div>
                  {/* Dense sheet: 2xs labels, alias hint as a title tooltip. */}
                  <div
                    className="provider-chosen-row-body"
                    id={advancedId}
                    hidden={!expanded}
                  >
                    <label className="provider-chosen-field">
                      <span className="provider-chosen-field-label">
                        {t("settings.modelAlias")}
                      </span>
                      <Input
                        value={binding.alias ?? ""}
                        placeholder={t("settings.modelAliasPlaceholder")}
                        title={t("settings.modelAliasHint")}
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                        onChange={(event) =>
                          updateBinding(binding.id, {
                            // Host-core caps the alias at 60 Unicode scalars, so
                            // clamp by code point rather than UTF-16 unit.
                            alias: [...event.target.value].slice(0, 60).join(""),
                          })
                        }
                      />
                    </label>
                    <div className="provider-chosen-limits">
                      <label className="provider-chosen-field">
                        <span className="provider-chosen-field-label">
                          {t("settings.contextWindow")}
                        </span>
                        <Input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={binding.contextWindow}
                          onChange={(event) =>
                            updateBinding(binding.id, {
                              contextWindow: Number(event.target.value) || 0,
                            })
                          }
                        />
                      </label>
                      <label className="provider-chosen-field">
                        <span className="provider-chosen-field-label">
                          {t("settings.maxOutput")}
                        </span>
                        <Input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={binding.maxTokens}
                          onChange={(event) =>
                            updateBinding(binding.id, {
                              maxTokens: Number(event.target.value) || 0,
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="provider-chosen-thinking">
                      <div className="provider-chosen-thinking-head">
                        <span className="provider-chosen-thinking-label">
                          {t("settings.supportedThinkingLevels")}
                        </span>
                        {publishedLevels.length === 0 ? (
                          <span className="provider-chosen-thinking-hint">
                            {t("settings.thinkingManualOverrideHint")}
                          </span>
                        ) : null}
                        {enabledLevels.length > 1 ? (
                          <label className="provider-chosen-thinking-default">
                            <span className="provider-chosen-thinking-label">
                              {t("settings.defaultThinkingLevel")}
                            </span>
                            <select
                              className="provider-chosen-thinking-select"
                              value={
                                binding.defaultThinkingLevel &&
                                enabledLevels.includes(binding.defaultThinkingLevel)
                                  ? binding.defaultThinkingLevel
                                  : (enabledLevels[0] ?? "")
                              }
                              onChange={(event) =>
                                updateBinding(binding.id, {
                                  defaultThinkingLevel: event.target
                                    .value as ThinkingLevel,
                                })
                              }
                            >
                              {enabledLevels.map((level) => (
                                <option key={level} value={level}>
                                  {level}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                      </div>
                      <div
                        className="provider-chosen-thinking-chips"
                        role="group"
                        aria-label={t("settings.supportedThinkingLevels")}
                      >
                        {levelChoices.map((level) => {
                          const on = binding.thinkingLevels.includes(level);
                          return (
                            <TooltipButton
                              key={level}
                              type="button"
                              className={cx("provider-thinking-chip", on && "selected")}
                              ariaLabel={level}
                              tooltip={level}
                              aria-pressed={on}
                              onClick={() => {
                                const next: ThinkingLevel[] = on
                                  ? binding.thinkingLevels.filter(
                                      (entry) => entry !== level,
                                    )
                                  : [...binding.thinkingLevels, level];
                                updateBinding(binding.id, {
                                  thinkingLevels: next,
                                  defaultThinkingLevel: next.includes(
                                    binding.defaultThinkingLevel as ThinkingLevel,
                                  )
                                    ? binding.defaultThinkingLevel
                                    : (sortThinkingLevels(next)[0] ?? null),
                                });
                              }}
                            >
                              {level}
                            </TooltipButton>
                          );
                        })}
                      </div>
                    </div>
                    <div className="provider-chosen-capabilities">
                      <span className="provider-chosen-thinking-label">
                        {t("settings.modelCapabilities")}
                      </span>
                      <div className="provider-chosen-capability-rows">
                        <CapabilityToggle
                          label={t("settings.imageInput")}
                          published={publishedImages}
                          value={binding.supportsImages}
                          onChange={(next) =>
                            updateBinding(binding.id, { supportsImages: next })
                          }
                        />
                        <CapabilityToggle
                          label={t("settings.documentInput")}
                          published={publishedDocuments}
                          value={binding.supportsDocuments}
                          onChange={(next) =>
                            updateBinding(binding.id, { supportsDocuments: next })
                          }
                        />
                        <span className="provider-chosen-delegation">
                          <label className="provider-chosen-capability">
                            <input
                              type="checkbox"
                              checked={binding.availableForSubagents ?? false}
                              onChange={(event) =>
                                updateBinding(binding.id, {
                                  availableForSubagents:
                                    event.target.checked || undefined,
                                })
                              }
                            />
                            <span>{t("settings.availableForSubagents")}</span>
                          </label>
                          <Tooltip
                            className="provider-chosen-delegation-help"
                            label={t("settings.availableForSubagentsHint")}
                            ariaLabel={t("settings.availableForSubagentsHint")}
                          >
                            <IconHelp size={13} />
                          </Tooltip>
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="provider-custom-model">
          <Field
            label={t("settings.customModel")}
            hint={customModelError || t("settings.customModelHint")}
          >
            <div className="provider-custom-model-row">
              <Input
                value={customModelId}
                placeholder={t("settings.customModelPlaceholder")}
                className="font-mono text-sm"
                onChange={(event) => {
                  setCustomModelId(event.target.value);
                  if (customModelError) setCustomModelError("");
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addCustomModel();
                }}
              />
              <Button variant="secondary" disabled={busy} onClick={addCustomModel}>
                <IconPlus size={14} />
                {t("settings.addCustomModel")}
              </Button>
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}

type CapabilityToggleProps = {
  label: string;
  /** What models.dev publishes for this model. */
  published: boolean;
  /** Stored override: `true`/`false` explicit, `null`/undefined follows. */
  value: boolean | null | undefined;
  onChange: (next: boolean | null) => void;
};

/**
 * One attachment capability as a plain checkbox showing the effective answer.
 *
 * The three stored states stay, but they need no third control: ticking the box
 * back to what models.dev publishes stores "follow the catalog" rather than an
 * equal-valued override, so agreeing with the catalog is the reset. That keeps a
 * later catalog correction flowing through without asking the user to
 * understand the distinction.
 */
function CapabilityToggle({ label, published, value, onChange }: CapabilityToggleProps) {
  const effective = typeof value === "boolean" ? value : published;
  return (
    <label className="provider-chosen-capability">
      <input
        type="checkbox"
        checked={effective}
        onChange={(event) =>
          onChange(event.target.checked === published ? null : event.target.checked)
        }
      />
      <span>{label}</span>
    </label>
  );
}
