/**
 * Page arithmetic for a market source that serves one page per request.
 *
 * The official pi package catalog cannot be handed over in one response: its
 * source reports how many hits the query matched and how many entries it puts in
 * one page, and the client asks for the page it wants to show. This module is
 * the whole of that arithmetic, so the pager and the request that feeds it
 * cannot disagree about which entries a page number names.
 */

/** A positive whole number, or null for anything that cannot name a count. */
function positiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.trunc(value)
    : null;
}

/**
 * Page size the source reported, or null when it does not page at all.
 *
 * A catalog source answers with its whole snapshot and reports no page size;
 * that is the signal to hide the pager rather than to invent a page of 100.
 */
export function resolveMarketPageSize(reported: number | null | undefined): number | null {
  return positiveInteger(reported);
}

/**
 * How many pages the whole match set spans, or null when it cannot be paged.
 *
 * The count is the source's own hit count over its own page width, so it is the
 * number of requests the catalog would answer — not the number of rows the list
 * ends up showing, because a hit the plugin id contract cannot encode is dropped
 * from the page it arrived in.
 */
export function resolveMarketPageCount(
  total: number | null | undefined,
  pageSize: number | null | undefined,
): number | null {
  const size = positiveInteger(pageSize);
  const hits =
    typeof total === "number" && Number.isFinite(total) ? Math.trunc(total) : 0;
  if (size === null || hits <= 0) return null;
  return Math.ceil(hits / size);
}

/** Offset the source reads from for a 1-based page number. */
export function marketPageOffset(page: number, pageSize: number): number {
  const size = positiveInteger(pageSize);
  if (size === null) return 0;
  return ((positiveInteger(page) ?? 1) - 1) * size;
}

/** Page number clamped to the pages that exist. */
export function clampMarketPage(
  page: number,
  pageCount: number | null | undefined,
): number {
  const wanted = positiveInteger(page) ?? 1;
  const last = positiveInteger(pageCount);
  return last === null ? wanted : Math.min(wanted, last);
}
