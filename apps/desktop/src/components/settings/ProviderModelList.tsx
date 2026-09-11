/**
 * What the service offers: the model picker's left pane.
 *
 * The search box is a view over the live rows, so the header checkbox selects
 * or clears exactly what is on screen.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModelsFetchErrorMessage } from "./ModelsFetchError";
import { ProviderModelListHead } from "./ProviderModelListHead";
import { ProviderModelRow } from "./ProviderModelRow";
import type { ModelRow } from "./ModelSelectionPanes";
import type { ProviderModelsState } from "./useProviderModels";

export type ProviderModelListProps = {
  discovery: ProviderModelsState & { canReload?: boolean };
  /** Heading of the discovered list: a service's models, or an account's. */
  listTitle: string;
  busy: boolean;
  rows: ModelRow[];
  /** Lowercased ids of the configured bindings, for the checkbox states. */
  selectedIds: Set<string>;
  onToggle: (row: ModelRow) => void;
  /** Add or drop every row the search box currently shows. */
  onSelectVisible: (visibleRows: ModelRow[], select: boolean) => void;
  onReveal: (row: ModelRow) => void;
  /** Probe the service's model list now, skipping the edit debounce. */
  onReload?: () => void;
};

export function ProviderModelList({
  discovery,
  listTitle,
  busy,
  rows,
  selectedIds,
  onToggle,
  onSelectVisible,
  onReveal,
  onReload,
}: ProviderModelListProps) {
  const { t } = useTranslation();
  const [modelQuery, setModelQuery] = useState("");

  // The returned list is short and already local, so filtering is client-side:
  // no host search and no debounced IPC round trip.
  const visibleRows = useMemo(() => {
    const needle = modelQuery.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.id.toLowerCase().includes(needle) ||
        row.displayName.toLowerCase().includes(needle),
    );
  }, [modelQuery, rows]);

  const visibleSelectedCount = useMemo(
    () => visibleRows.filter((row) => selectedIds.has(row.id.toLowerCase())).length,
    [selectedIds, visibleRows],
  );
  const fetchFailed = discovery.status === "error";
  const emptyFetchError = fetchFailed && rows.length === 0;

  const listBody =
    discovery.status === "idle" ? (
      <div className="provider-models-placeholder">{t("settings.modelsEmptyHint")}</div>
    ) : emptyFetchError ? (
      <ModelsFetchErrorMessage error={discovery.error} variant="placeholder" />
    ) : rows.length === 0 ? (
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
          <ProviderModelRow
            key={row.id}
            row={row}
            chosen={selectedIds.has(row.id.toLowerCase())}
            busy={busy}
            onToggle={() => onToggle(row)}
            onReveal={() => onReveal(row)}
          />
        ))}
      </ul>
    );

  return (
    <div className="provider-models">
      <ProviderModelListHead
        listTitle={listTitle}
        busy={busy}
        query={modelQuery}
        onQueryChange={setModelQuery}
        visibleCount={visibleRows.length}
        allSelected={visibleSelectedCount === visibleRows.length && visibleRows.length > 0}
        someSelected={visibleSelectedCount > 0 && visibleSelectedCount < visibleRows.length}
        onSelectAll={(select) => onSelectVisible(visibleRows, select)}
        loading={discovery.status === "loading"}
        canReload={discovery.canReload}
        onReload={onReload}
      />

      {discovery.source === "catalog" ? (
        <div className="provider-models-note">{t("settings.modelsFromCatalogNote")}</div>
      ) : null}
      {discovery.source === "fallback" ? (
        <div className="provider-models-note">{t("settings.modelsFallbackNote")}</div>
      ) : null}
      {fetchFailed && !emptyFetchError ? (
        <ModelsFetchErrorMessage error={discovery.error} variant="banner" />
      ) : null}

      {listBody}
    </div>
  );
}
