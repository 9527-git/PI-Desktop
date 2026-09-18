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
import {
  CONTEXT_WINDOW_PRESETS,
  MAX_OUTPUT_PRESETS,
  matchPresetIndex,
} from "../../lib/model-limit-presets";
import { Button, Field, Input, Tooltip, TooltipButton, cx } from "../ui";
import { IconClose, IconHelp, IconPlus, IconRefresh, IconSearch } from "../icons";
import { DiscoveredModelRow } from "./DiscoveredModelRow";
import { filterChosenModels, hidesAddedBinding } from "./model-chosen-filter";
import { describeModelsFetchError } from "./model-fetch-error";
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
 * Add every currently visible row that is not chosen yet.
 *
 * The search box is a view over the live list, so "all" means the rows on
 * screen: a filtered select-all does not touch hidden matches. Already-chosen
 * bindings keep their advanced overrides. There is deliberately no bulk clear:
 * in fallback mode the visible rows are the configured models themselves, so a
 * one-step removal could drop bindings the live answer may never offer again.
 */
export function applyVisibleModelSelection(
  current: ModelBinding[],
  visibleRows: ModelRow[],
): ModelBinding[] {
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
  /**
   * Ids the discovered list should stop showing, persisted by the caller with
   * the provider record. Absent support keeps the list unfiltered.
   */
  hiddenModels?: string[];
  /** Replace the hidden set; called by delete and by the restore entry. */
  onHiddenModelsChange?: (next: string[]) => void;
  /**
   * Bindings unchecked in this or a previous editing session, persisted by the
   * caller with the provider record so an unchecked row keeps its parameters
   * across save and reopen. Absent support keeps the memory session-only.
   */
  disabledModels?: ModelBinding[];
  /** Replace the unchecked set; called by uncheck, re-check, and delete. */
  onDisabledModelsChange?: (next: ModelBinding[]) => void;
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
  hiddenModels,
  onHiddenModelsChange,
  disabledModels,
  onDisabledModelsChange,
}: ModelSelectionPanesProps) {
  const { t } = useTranslation();
  const { rows, models, publishedLevelsById, setModels } = selection;
  // Bindings removed by unchecking, kept so re-checking restores the exact
  // parameters instead of catalog defaults. State (not a ref) because the
  // remembered rows must re-enter the left list: in fallback mode the list is
  // built from the configured bindings alone, so a ref-only memory would leave
  // an unchecked row with nothing to render. The set is seeded from the
  // provider record and every change is reported back, so unchecking survives
  // a save and reopen instead of silently deleting the model.
  const [remembered, setRemembered] = useState<Map<string, ModelBinding>>(() => {
    const seeded = new Map<string, ModelBinding>();
    for (const binding of disabledModels ?? []) {
      seeded.set(binding.id.toLowerCase(), binding);
    }
    return seeded;
  });
  /** Persist every unchecked-set change alongside the provider record. */
  const updateRemembered = (next: Map<string, ModelBinding>) => {
    setRemembered(next);
    onDisabledModelsChange?.([...next.values()]);
  };
  const removeFromRemembered = (key: string) => {
    if (!remembered.has(key)) return;
    const next = new Map(remembered);
    next.delete(key);
    updateRemembered(next);
  };
  const addToRemembered = (key: string, binding: ModelBinding) => {
    if (remembered.get(key) === binding) return;
    const next = new Map(remembered);
    next.set(key, binding);
    updateRemembered(next);
  };
  const [modelQuery, setModelQuery] = useState("");
  const [chosenQuery, setChosenQuery] = useState("");
  const [customModelId, setCustomModelId] = useState("");
  const [customModelError, setCustomModelError] = useState("");
  const [expandedModelId, setExpandedModelId] = useState<string | null>(
    () => models[0]?.id ?? null,
  );
  // The left list points into the right pane, so a click on a configured
  // model opens its settings instead of dropping it. The row it opened is
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

  const hiddenSet = useMemo(
    () => new Set((hiddenModels ?? []).map((id) => id.toLowerCase())),
    [hiddenModels],
  );
  // A remembered (unchecked) binding keeps its row listed even when no
  // discovery source mentions it any more: the fallback list is exactly the
  // configured bindings, so without this merge an uncheck would delete the
  // row outright instead of leaving it listed unchecked. Live rows win — a
  // remembered id that the service still advertises keeps its richer row.
  const displayRows = useMemo<ModelRow[]>(() => {
    if (remembered.size === 0) return rows;
    const listed = new Set(rows.map((row) => row.id.toLowerCase()));
    const merged = [...rows];
    for (const [key, binding] of remembered) {
      if (listed.has(key)) continue;
      merged.push({
        id: binding.id,
        displayName: binding.id,
        contextWindow: binding.contextWindow,
        maxTokens: binding.maxTokens,
      });
    }
    return merged;
  }, [remembered, rows]);
  // A hidden id stops its discovered row from listing. A row that still has a
  // binding always shows: delete removes the binding and hides together, so an
  // overlap is stale state worth displaying rather than burying.
  const listedRows = useMemo(
    () =>
      hiddenSet.size === 0
        ? displayRows
        : displayRows.filter(
            (row) => row.binding || !hiddenSet.has(row.id.toLowerCase()),
          ),
    [displayRows, hiddenSet],
  );

  // The returned list is short and already local, so filtering is client-side:
  // no host search and no debounced IPC round trip.
  const visibleRows = useMemo(() => {
    const needle = modelQuery.trim().toLowerCase();
    if (!needle) return listedRows;
    return listedRows.filter(
      (row) =>
        row.id.toLowerCase().includes(needle) ||
        row.displayName.toLowerCase().includes(needle),
    );
  }, [listedRows, modelQuery]);

  const selected = useMemo(
    () => new Set(models.map((binding) => binding.id.toLowerCase())),
    [models],
  );
  const visibleSelectedCount = useMemo(
    () => visibleRows.filter((row) => selected.has(row.id.toLowerCase())).length,
    [selected, visibleRows],
  );
  const allVisibleSelected =
    visibleRows.length > 0 && visibleSelectedCount === visibleRows.length;
  const someVisibleSelected =
    visibleSelectedCount > 0 && visibleSelectedCount < visibleRows.length;

  // Published records for the chosen rows, so the capability switches can show
  // what models.dev says before the user overrides it.
  const infoById = useMemo(() => {
    const byId = new Map<string, ModelInfo>();
    for (const row of listedRows) if (row.info) byId.set(row.id.toLowerCase(), row.info);
    return byId;
  }, [listedRows]);

  // An emptied list disables the field, so a filter still sitting in it could
  // no longer be cleared by the user. Drop it with the last configured model.
  useEffect(() => {
    if (models.length === 0) setChosenQuery("");
  }, [models.length]);

  /**
   * The chosen list narrows with the discovered list's rule plus the binding's
   * alias: a case-insensitive substring match over the id, the alias, and the
   * catalog display name, so a friendly name finds the id it stands for. The
   * rule lives in `model-chosen-filter`, so the pane, the add paths below, and
   * the tests execute one implementation instead of three copies of it.
   */
  const visibleChosen = useMemo(
    () => filterChosenModels(models, chosenQuery, listedRows),
    [chosenQuery, listedRows, models],
  );

  /** A discovered row arrives enriched; a hand-typed id gets generic limits. */
  const bindingForRow = (row: ModelRow): ModelBinding =>
    row.info ? bindingFromModelInfo(row.info) : bindingForCustomModel(row.id);

  /**
   * The rule for a model that is being added: a filter is kept while it still
   * shows the new row and dropped when the row would land out of view, so
   * nothing the user just added hides behind a search typed earlier.
   */
  const keepAddedModelVisible = (added: ModelBinding[]) => {
    if (hidesAddedBinding(added, chosenQuery, displayRows)) setChosenQuery("");
  };

  /**
   * Activate one discovered row: add it if absent, otherwise open what is
   * already configured. Deliberately not a toggle - selecting a model in the
   * left pane must never delete a binding, so removal stays an explicit action
   * in the chosen pane. The selection helper is idempotent, so an absent model
   * is added once even if React invokes the updater twice in one batch, and an
   * existing binding keeps its original object, order and overrides.
   */
  const selectModel = (row: ModelRow) => {
    if (busy) return;
    const key = row.id.toLowerCase();
    const existing = models.find((entry) => entry.id.toLowerCase() === key);
    // An unchecked remembered row has no binding to open: restore the exact
    // remembered parameters, exactly like a re-check, instead of defaults.
    if (!existing && remembered.has(key)) {
      toggleModel(row, true);
      return;
    }
    const binding = existing ?? bindingForRow(row);
    // Open the stored id so the right pane reveals exactly what is configured.
    setExpandedModelId(binding.id);
    keepAddedModelVisible([binding]);
    setModels((current) => applyVisibleModelSelection(current, [row]));
    // A configured model keeps the scroll-and-mark reveal on repeat activation.
    if (existing) revealModelConfig(row);
  };

  /**
   * The header checkbox as a real toggle. Checking adds every visible row that
   * is not chosen yet, restoring a remembered binding's exact parameters the
   * same way a single re-check does.
   */
  const selectAllVisibleModels = () => {
    setExpandedModelId((open) => open ?? visibleRows[0]?.id ?? null);
    const added = visibleRows
      .filter((row) => !selected.has(row.id.toLowerCase()))
      // A remembered (unchecked) row restores its exact parameters, the same
      // way a single re-check does, instead of catalog defaults.
      .map((row) => remembered.get(row.id.toLowerCase()) ?? bindingForRow(row));
    keepAddedModelVisible(added);
    setModels((current) => (added.length === 0 ? current : [...current, ...added]));
  };

  /**
   * Unchecking the header drops every visible binding, but exactly like a row
   * uncheck it stays soft: each removed binding is remembered (persisted in
   * `disabledModels` since D442) so the row keeps its place, unchecked, and a
   * re-check restores its saved parameters. D440 made this control add-only to
   * stop a fallback bulk-clear from deleting configured models the live probe
   * might never offer again; D442's persisted memory removed that danger, so
   * the checkbox can finally behave like one. Only visible rows are touched, so
   * a search filter still confines the bulk action to what is on screen.
   */
  const clearAllVisibleModels = () => {
    const visibleKeys = new Set(visibleRows.map((row) => row.id.toLowerCase()));
    const removed = models.filter((binding) =>
      visibleKeys.has(binding.id.toLowerCase()),
    );
    if (removed.length === 0) return;
    const next = new Map(remembered);
    for (const binding of removed) next.set(binding.id.toLowerCase(), binding);
    updateRemembered(next);
    setModels((current) =>
      current.filter((binding) => !visibleKeys.has(binding.id.toLowerCase())),
    );
  };

  /**
   * A click on a configured model's row in the left list: open its settings
   * and bring the row into view. A model that is not configured yet has no
   * settings to show, so the checkbox stays the only way to drop one.
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

  /**
   * The row checkbox as a real toggle. Unchecking removes the binding but
   * keeps the row listed, and remembers the binding so re-checking within
   * this editing session restores its parameters (an accidental uncheck must
   * not silently reset alias, limits, and thinking levels). Checking adds -
   * from the memory when present - and opens the model's settings.
   */
  const toggleModel = (row: ModelRow, checked: boolean) => {
    if (busy) return;
    const key = row.id.toLowerCase();
    if (checked) {
      const restored = remembered.get(key);
      const binding = restored ?? bindingForRow(row);
      removeFromRemembered(key);
      setModels((current) =>
        current.some((entry) => entry.id.toLowerCase() === key)
          ? current
          : [...current, binding],
      );
      setExpandedModelId(binding.id);
      keepAddedModelVisible([binding]);
      return;
    }
    const existing = models.find((entry) => entry.id.toLowerCase() === key);
    if (existing) {
      addToRemembered(key, existing);
    }
    setModels((current) => current.filter((entry) => entry.id.toLowerCase() !== key));
  };

  /**
   * The chosen pane's delete: the binding is removed and the discovered row
   * stops listing, so a model the service still advertises does not come back
   * to taunt an already-made decision. Any remembered parameters for the id
   * are dropped - this is the destructive action; unchecking is the soft one.
   */
  const deleteModel = (binding: ModelBinding) => {
    const key = binding.id.toLowerCase();
    removeFromRemembered(key);
    setModels((current) => current.filter((entry) => entry.id.toLowerCase() !== key));
    if (hiddenSet.has(key)) return;
    onHiddenModelsChange?.([...(hiddenModels ?? []), binding.id]);
  };

  /** Restore every hidden row to the list; the bindings stay untouched. */
  const showHiddenModels = () => onHiddenModelsChange?.([]);

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
    const binding = bindingForCustomModel(id);
    setModels((current) => [...current, binding]);
    setExpandedModelId(id);
    setCustomModelId("");
    setCustomModelError("");
    keepAddedModelVisible([binding]);
    // Re-adding a hidden id by hand is an explicit request to see it again.
    if (hiddenSet.has(id.toLowerCase())) {
      onHiddenModelsChange?.(
        (hiddenModels ?? []).filter((hidden) => hidden.toLowerCase() !== id.toLowerCase()),
      );
    }
  };

  const fetchFailed = discovery.status === "error";
  // Remembered (unchecked) rows still render in fallback mode, so the fetch
  // error placeholder only owns the screen when there is truly nothing listed.
  const emptyFetchError = fetchFailed && displayRows.length === 0;

  const hiddenCount = (hiddenModels ?? []).filter(
    (id) => !models.some((binding) => binding.id.toLowerCase() === id.toLowerCase()),
  ).length;

  const modelListBody =
    discovery.status === "idle" ? (
      <div className="provider-models-placeholder">{t("settings.modelsEmptyHint")}</div>
    ) : emptyFetchError ? (
      <ModelsFetchErrorMessage error={discovery.error} variant="placeholder" />
    ) : listedRows.length === 0 ? (
      <div className="provider-models-placeholder">
        {discovery.status === "loading"
          ? t("settings.modelsLoading")
          : t("settings.modelsNoneFromService")}
      </div>
    ) : visibleRows.length === 0 ? (
      <div className="provider-models-placeholder">{t("settings.noModelMatches")}</div>
    ) : (
      <ul className="provider-models-list">
        {visibleRows.map((row) => (
          <DiscoveredModelRow
            key={row.id}
            row={row}
            chosen={selected.has(row.id.toLowerCase())}
            busy={busy}
            onSelect={() => selectModel(row)}
            onToggle={(checked) => toggleModel(row, checked)}
          />
        ))}
      </ul>
    );

  return (
    <div className="provider-setup-panes">
      <div className="provider-models">
        <div className="provider-models-head">
          <div className="provider-models-heading">
            {/* A real toggle since D443: checking adds every visible row,
                unchecking drops them softly - each stays listed and remembered
                (persisted via disabledModels), so a fallback bulk-clear can no
                longer lose a configured model. */}
            {visibleRows.length > 0 ? (
              <input
                type="checkbox"
                className="provider-models-check provider-models-select-all"
                checked={allVisibleSelected}
                disabled={busy}
                ref={(el) => {
                  if (el) el.indeterminate = someVisibleSelected;
                }}
                aria-label={t("settings.selectAllVisibleModels")}
                title={t("settings.selectAllModelsHint")}
                onChange={(event) => {
                  if (event.target.checked) selectAllVisibleModels();
                  else clearAllVisibleModels();
                }}
              />
            ) : null}
            <h4 className="provider-models-title">{listTitle}</h4>
            {onReload ? (
              <button
                type="button"
                className={cx(
                  "provider-models-reload",
                  discovery.status === "loading" && "is-loading",
                )}
                disabled={busy || !discovery.canReload}
                onClick={onReload}
              >
                <IconRefresh size={13} aria-hidden />
                {discovery.status === "loading"
                  ? t("settings.modelsLoading")
                  : t("settings.fetchModelList")}
              </button>
            ) : null}
          </div>
          <div className="provider-models-search-wrap">
            <IconSearch size={13} aria-hidden />
            <input
              className="provider-models-search"
              value={modelQuery}
              placeholder={t("settings.searchModelId")}
              aria-label={t("settings.searchModelId")}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              onChange={(event) => setModelQuery(event.target.value)}
            />
          </div>
        </div>

        {discovery.source === "catalog" ? (
          <div className="provider-models-note">{t("settings.modelsFromCatalogNote")}</div>
        ) : null}
        {discovery.source === "fallback" ? (
          <div className="provider-models-note">{t("settings.modelsFallbackNote")}</div>
        ) : null}
        {fetchFailed && !emptyFetchError ? (
          <ModelsFetchErrorMessage error={discovery.error} variant="banner" />
        ) : null}

        {modelListBody}
        {hiddenCount > 0 && onHiddenModelsChange ? (
          <div className="provider-models-hidden">
            <span>{t("settings.hiddenModelsCount", { count: hiddenCount })}</span>
            <button type="button" onClick={showHiddenModels}>
              {t("settings.showHiddenModels")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="provider-chosen">
        <div className="provider-chosen-head">
          <h4 className="provider-chosen-title">{t("settings.modelConfigurations")}</h4>
          <span className="provider-chosen-count">{models.length}</span>
          <div className="provider-chosen-search-wrap">
            <IconSearch size={13} aria-hidden />
            <input
              className="provider-chosen-search"
              value={chosenQuery}
              placeholder={t("settings.searchChosenModels")}
              aria-label={t("settings.searchChosenModels")}
              disabled={busy || models.length === 0}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              onChange={(event) => setChosenQuery(event.target.value)}
            />
          </div>
        </div>
        {models.length === 0 ? (
          <div className="provider-chosen-empty">{t("settings.noModelsChosen")}</div>
        ) : visibleChosen.length === 0 ? (
          <div className="provider-chosen-empty">{t("settings.noChosenModelMatches")}</div>
        ) : (
          <ul className="provider-chosen-list">
            {visibleChosen.map((binding) => {
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
                      onClick={() => deleteModel(binding)}
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
                        {/* Preset ladder (#202): click writes the token count;
                            the input stays hand-editable off the ladder. */}
                        <div
                          className="provider-limit-presets"
                          role="group"
                          aria-label={t("settings.contextWindow")}
                        >
                          {CONTEXT_WINDOW_PRESETS.map((preset, index) => {
                            const on =
                              matchPresetIndex(
                                CONTEXT_WINDOW_PRESETS,
                                binding.contextWindow,
                              ) === index;
                            return (
                              <TooltipButton
                                key={preset.label}
                                type="button"
                                className={cx(
                                  "provider-thinking-chip",
                                  on && "selected",
                                )}
                                ariaLabel={preset.label}
                                tooltip={preset.label}
                                aria-pressed={on}
                                onClick={() =>
                                  updateBinding(binding.id, {
                                    contextWindow: preset.tokens,
                                  })
                                }
                              >
                                {preset.label}
                              </TooltipButton>
                            );
                          })}
                        </div>
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
                        <div
                          className="provider-limit-presets"
                          role="group"
                          aria-label={t("settings.maxOutput")}
                        >
                          {MAX_OUTPUT_PRESETS.map((preset, index) => {
                            const on =
                              matchPresetIndex(
                                MAX_OUTPUT_PRESETS,
                                binding.maxTokens,
                              ) === index;
                            return (
                              <TooltipButton
                                key={preset.label}
                                type="button"
                                className={cx(
                                  "provider-thinking-chip",
                                  on && "selected",
                                )}
                                ariaLabel={preset.label}
                                tooltip={preset.label}
                                aria-pressed={on}
                                onClick={() =>
                                  updateBinding(binding.id, {
                                    maxTokens: preset.tokens,
                                  })
                                }
                              >
                                {preset.label}
                              </TooltipButton>
                            );
                          })}
                        </div>
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

function ModelsFetchErrorMessage({
  error,
  variant,
}: {
  error?: string;
  variant: "banner" | "placeholder";
}) {
  const { t } = useTranslation();
  const view = describeModelsFetchError(error);
  let summary = t("settings.modelsFetchFailed");
  switch (view.kind) {
    case "unauthorized":
      summary = t("errors.PROVIDER_UNAUTHORIZED");
      break;
    case "notFound":
      summary = t("settings.modelsFetchNotFound");
      break;
    case "rateLimited":
      summary = t("errors.PROVIDER_RATE_LIMITED");
      break;
    case "timeout":
      summary = t("errors.TIMEOUT");
      break;
    case "network":
      summary = t("errors.NETWORK_ERROR");
      break;
    case "invalidResponse":
      summary = t("settings.modelsFetchInvalidResponse");
      break;
    case "http":
      summary = t("settings.modelsFetchFailedStatus", {
        status: view.summaryParams?.status ?? 0,
      });
      break;
  }
  const className =
    variant === "placeholder"
      ? "provider-models-placeholder is-error"
      : "provider-models-note is-error";
  return (
    <div className={className} role="alert">
      <span className="provider-models-error-summary">{summary}</span>
      {view.detail ? (
        <span className="provider-models-error-detail">{view.detail}</span>
      ) : null}
      {variant === "placeholder" ? (
        <span className="provider-models-error-hint">{t("settings.modelsFetchHint")}</span>
      ) : null}
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
