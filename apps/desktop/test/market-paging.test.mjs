import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const {
  clampMarketPage,
  marketPageOffset,
  resolveMarketPageCount,
  resolveMarketPageSize,
} = await import("../src/features/plugins/market-paging.ts");

test("a source that reports no page size offers no pages", () => {
  // A catalog source answers with its whole snapshot: no page size means no
  // pager, rather than a first page pretending to be the whole list.
  assert.equal(resolveMarketPageSize(undefined), null);
  assert.equal(resolveMarketPageSize(null), null);
  assert.equal(resolveMarketPageSize(0), null);
  assert.equal(resolveMarketPageSize(-100), null);
  assert.equal(resolveMarketPageSize(100), 100);
  assert.equal(resolveMarketPageSize(100.6), 100);
});

test("the page count is the source's hit count over its page width", () => {
  assert.equal(resolveMarketPageCount(10_556, 100), 106);
  assert.equal(resolveMarketPageCount(150, 100), 2);
  assert.equal(resolveMarketPageCount(100, 100), 1);
  // Nothing matched, or nothing can be paged.
  assert.equal(resolveMarketPageCount(0, 100), null);
  assert.equal(resolveMarketPageCount(10_556, null), null);
  assert.equal(resolveMarketPageCount(undefined, 100), null);
});

test("a page number becomes the offset the source reads from", () => {
  assert.equal(marketPageOffset(1, 100), 0);
  assert.equal(marketPageOffset(2, 100), 100);
  assert.equal(marketPageOffset(106, 100), 10_500);
  // A page number that cannot name a page reads the first one.
  assert.equal(marketPageOffset(0, 100), 0);
  assert.equal(marketPageOffset(Number.NaN, 100), 0);
});

test("page numbers are clamped to the pages that exist", () => {
  assert.equal(clampMarketPage(0, 106), 1);
  assert.equal(clampMarketPage(3, 106), 3);
  assert.equal(clampMarketPage(999, 106), 106);
  // Without a count there is nothing to clamp against.
  assert.equal(clampMarketPage(999, null), 999);
});
