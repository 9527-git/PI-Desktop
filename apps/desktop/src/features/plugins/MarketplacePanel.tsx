import { Button, cx } from "../../components/ui";
import { IconCheck, IconSearch, IconShield } from "../../components/icons";
import { MarketplaceSourceSettings } from "../../components/plugins/MarketplaceSourceSettings";
import { PermissionChips } from "./presentation";
import {
  formatBytes,
  formatDate,
  monogram,
  showsVerifiedBadge,
  versionInstallable,
  versionWithdrawn,
} from "./model";
import type { PluginsPageModel } from "./usePluginsPage";

export function MarketplacePanel({
  t,
  locale,
  settings,
  query,
  setQuery,
  refreshMarket,
  setMarketSource,
  categories,
  category,
  setCategory,
  marketLoadingMore,
  marketNextOffset,
  marketTotal,
  loadMoreMarket,
  marketLoading,
  market,
  visibleMarket,
  installedById,
  selectedId,
  openDetail,
  busyId,
  queueInstall,
}: PluginsPageModel) {
  return (
          <div
            id="plugins-panel-market"
            role="tabpanel"
            aria-labelledby="plugins-tab-market"
            className="plugins-panel"
          >
            {settings ? (
              <MarketplaceSourceSettings
                settings={settings}
                onSourceRefreshed={(source) => {
                  setMarketSource(source);
                  void refreshMarket(query);
                }}
              />
            ) : null}

            {categories.length > 1 ? (
              <div
                className="plugins-filters"
                role="group"
                aria-label={t("plugins.categories")}
              >
                <button
                  type="button"
                  className={cx("plugins-filter", !category && "active")}
                  aria-pressed={!category}
                  onClick={() => setCategory("")}
                >
                  {t("plugins.categoryAll")}
                </button>
                {categories.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={cx("plugins-filter", category === value && "active")}
                    aria-pressed={category === value}
                    onClick={() => setCategory(category === value ? "" : value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            ) : null}

            {marketLoading && market.length === 0 ? (
              <div className="plugins-card-grid" aria-hidden>
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="plugins-card is-skeleton">
                    <span className="plugins-skeleton-line is-short" />
                    <span className="plugins-skeleton-line" />
                    <span className="plugins-skeleton-line is-long" />
                  </div>
                ))}
              </div>
            ) : visibleMarket.length === 0 ? (
              <div className="plugins-empty">
                <span className="plugins-empty-icon" aria-hidden>
                  <IconSearch size={18} />
                </span>
                <p className="plugins-empty-title">{t("plugins.marketEmpty")}</p>
                <div className="plugins-empty-actions">
                  {query || category ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuery("");
                        setCategory("");
                      }}
                    >
                      {t("plugins.clearSearch")}
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    onClick={() => void refreshMarket(query, { refreshRemote: true })}
                  >
                    {t("plugins.refreshMarket")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="plugins-card-grid" role="list">
                {visibleMarket.map((item) => {
                  const installed = installedById.get(item.id);
                  const upgradable = !!installed && !!item.updateAvailable;
                  // Older hosts do not report the field; absence means the
                  // catalog was trusted, so only an explicit false blocks.
                  const packagePending = item.installable === false;
                  // A source that reads its entries per query can offer one
                  // whose package has not been read yet. Installing from here
                  // would ask for consent to a permission list nobody derived,
                  // so the card points at the detail sheet, which reads the
                  // package and shows what the install would actually ask for.
                  const readFirst = packagePending && item.installBlocked === "not_read";
                  const unsupported = packagePending && item.installBlocked === "unsupported";
                  return (
                    <article
                      key={item.id}
                      role="listitem"
                      className={cx("plugins-card", selectedId === item.id && "active")}
                    >
                      <button
                        type="button"
                        className="plugins-card-hit"
                        aria-label={t("plugins.viewDetailsOf", { name: item.name })}
                        onClick={() => void openDetail(item.id)}
                      >
                        <span className="plugins-card-head">
                          <span className="plugins-card-glyph" aria-hidden>
                            {monogram(item.name)}
                          </span>
                          <span className="plugins-card-ident">
                            <span className="plugins-card-title">
                              <span className="plugins-card-name">{item.name}</span>
                              {showsVerifiedBadge(item) ? (
                                <span
                                  className="plugins-verified"
                                  title={t("plugins.verified")}
                                  aria-label={t("plugins.verified")}
                                >
                                  <IconShield size={12} />
                                </span>
                              ) : null}
                            </span>
                            <span className="plugins-card-meta">
                              <span className="plugins-card-author">{item.author}</span>
                              <span className="plugins-dot" aria-hidden>
                                ·
                              </span>
                              <span>v{item.latestVersion}</span>
                              {item.downloads != null ? (
                                <>
                                  <span className="plugins-dot" aria-hidden>
                                    ·
                                  </span>
                                  <span>
                                    {t("plugins.downloads", { count: item.downloads })}
                                  </span>
                                </>
                              ) : null}
                            </span>
                          </span>
                        </span>
                        <span className="plugins-card-desc">{item.description}</span>
                        <PermissionChips permissions={item.permissionSummary} />
                      </button>
                      <div className="plugins-card-foot">
                        <span className="plugins-card-state">
                          {installed
                            ? t("plugins.installedVersion", { version: installed.version })
                            : t("plugins.updatedOn", {
                                date: formatDate(item.updatedAt, locale),
                              })}
                        </span>
                        {installed && !upgradable ? (
                          <span className="plugins-installed-mark">
                            <IconCheck size={13} />
                            {t("plugins.installedLabel")}
                          </span>
                        ) : readFirst ? (
                          <span className="plugins-card-hint">{t("plugins.installOnlyInDetail")}</span>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={busyId === item.id || packagePending}
                            title={
                              unsupported
                                ? t("plugins.installBlockedPackage")
                                : packagePending
                                  ? t("plugins.packagePendingHint", {
                                      version: item.latestVersion,
                                    })
                                  : undefined
                            }
                            onClick={() =>
                              queueInstall({
                                id: item.id,
                                name: item.name,
                                // An update is granted against what the user
                                // already holds plus what the new version adds;
                                // a fresh install asks for what the listing
                                // declared. A source whose listing carries no
                                // permission list therefore still updates
                                // through the permissions already granted.
                                permissions: installed
                                  ? [
                                      ...new Set([
                                        ...(installed.permissions ?? []),
                                        ...(installed.updateAvailable?.permissionDiff ?? []),
                                      ]),
                                    ]
                                  : (item.permissionSummary ?? []),
                                version: item.latestVersion,
                              })
                            }
                          >
                            {unsupported
                              ? t("plugins.installBlockedPackage")
                              : packagePending
                                ? t("plugins.packagePending")
                                : busyId === item.id
                                  ? t("plugins.installing")
                                  : upgradable
                                    ? t("plugins.updateNow")
                                    : t("plugins.install")}
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {marketNextOffset !== null ? (
              <div className="plugins-load-more">
                <Button
                  variant="secondary"
                  disabled={marketLoadingMore}
                  onClick={() => void loadMoreMarket()}
                >
                  {marketLoadingMore ? t("plugins.loadingMore") : t("plugins.loadMore")}
                </Button>
                {marketTotal !== null ? (
                  // Numbers need no translation; the pair is what tells the
                  // user this list is a window onto a much larger catalog.
                  <span className="plugins-load-more-count" aria-live="polite">
                    {`${market.length} / ${marketTotal}`}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
);
}
