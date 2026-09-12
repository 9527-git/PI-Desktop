/**
 * The left pane's own controls: the select-all checkbox, the heading, the
 * reload action and the search box.
 *
 * "All" always means the rows on screen, so the caller owns both the filter and
 * the rows it currently shows; this component only reports what was asked for.
 */
import { useTranslation } from "react-i18next";
import { cx } from "../ui";
import { IconRefresh, IconSearch } from "../icons";

export type ProviderModelListHeadProps = {
  listTitle: string;
  busy: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  /** Rows the search box shows; none hides the select-all control. */
  visibleCount: number;
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: (select: boolean) => void;
  loading: boolean;
  canReload?: boolean;
  /** Probe the service's model list now, skipping the edit debounce. */
  onReload?: () => void;
};

export function ProviderModelListHead({
  listTitle,
  busy,
  query,
  onQueryChange,
  visibleCount,
  allSelected,
  someSelected,
  onSelectAll,
  loading,
  canReload,
  onReload,
}: ProviderModelListHeadProps) {
  const { t } = useTranslation();
  const selectAllLabel = t(
    allSelected ? "settings.deselectAllVisibleModels" : "settings.selectAllVisibleModels",
  );

  return (
    <div className="provider-models-head">
      <div className="provider-models-heading">
        {visibleCount > 0 ? (
          <input
            type="checkbox"
            className="provider-models-check provider-models-select-all"
            checked={allSelected}
            disabled={busy}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            aria-label={selectAllLabel}
            title={selectAllLabel}
            onChange={(event) => onSelectAll(event.target.checked)}
          />
        ) : null}
        <h4 className="provider-models-title">{listTitle}</h4>
        {onReload ? (
          <button
            type="button"
            className={cx("provider-models-reload", loading && "is-loading")}
            disabled={busy || !canReload}
            onClick={onReload}
          >
            <IconRefresh size={13} aria-hidden />
            {loading ? t("settings.modelsLoading") : t("settings.fetchModelList")}
          </button>
        ) : null}
      </div>
      <div className="provider-models-search-wrap">
        <IconSearch size={13} aria-hidden />
        <input
          className="provider-models-search"
          value={query}
          placeholder={t("settings.searchModelId")}
          aria-label={t("settings.searchModelId")}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
    </div>
  );
}
