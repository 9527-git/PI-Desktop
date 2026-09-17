# Context Inspector Compact Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The context-usage popover card (`ContextUsageInspector`) starts a manual
context compaction for the active session and reports the result in place.

**Architecture:** Renderer-only feature. Two additive changes: (1) the
renderer-facing `ContextCompactionMark` gains the optional `tokensBefore` figure
that its durable record already stores, and both memo comparisons follow the new
field; (2) the inspector popover gains a bottom action row that calls the
existing store action `compactContext()` and derives its busy state from the
runtime's own `activity.phase === "compacting"`. No new IPC channel, no runtime,
host-core, storage, or permission change.

**Tech Stack:** React 19 + TypeScript (renderer), Zustand store actions,
`@pi-desktop/shared` types, i18next locale catalogs (8 locales), vitest
(packages), `node:test` source-contract tests (apps/desktop), CDP-driven
Electron E2E scripts (`scripts/e2e-*.mjs`).

**Spec:** `docs/project/2026-09-17-context-inspector-compact-action-design.md`
(approved 2026-09-17; commit `3e96976a`).

---

## Working contract

- Worktree: `E:\pi-pro\PI-Desktop\.worktrees\feat\context-inspector-compact-action`
- Branch: `feat/context-inspector-compact-action`, based on local `main` @
  `b9f621ed` (v0.14.24).
- Every command below runs from the worktree root in Git Bash (the shell's CWD
  is already the worktree root). Do **not** `cd` into it again.
- All code, comments, commits, and specs are English (AGENTS.md §1).
- Commit only the files listed in each task. One logical concern per commit.
- Never push to `origin`; local `main` is the delivery line, remote needs
  explicit confirmation (project memory `remotes-stale-local-main-line`).
- Release version bumps are **not** part of this plan; they happen only on an
  explicit release request.

### Corrections to the design doc (verified against source)

1. `compactionMarksEqual` lives in
   `apps/desktop/src/features/chat/transcript/AssistantTurn.tsx:82`, not in
   `lib/assistant-turns.ts`. A **second** inline mark comparison lives in
   `apps/desktop/src/lib/assistant-turns.ts:327-336` (`reuseTranscriptEntry`).
   Both sites must follow `tokensBefore`, otherwise a mark whose only change is
   the new figure is memoized away and the "before" line never renders.
   Behavioral coverage for both comparators lives in
   `apps/desktop/test/assistant-turns.test.mjs`, which exercises the exported
   `reuseTranscriptEntries` (the memo comparator itself is not directly
   testable from a plain source test).
2. `ContextCompactionRecord.tokensBefore` is **required** (`packages/shared/src/types/sessions.ts:81`,
   Rust `tokens_before: i64`), so `contextCompactionMark()` assigns it directly
   and the shared test's exact `toEqual` gains `tokensBefore: 120_000`. The
   design's "omits it when the record has none" case is impossible and is
   replaced by a focused pass-through case. The runtime test uses
   `tokensBefore: expect.any(Number)`.
3. Decision number is **D434** (local `main` `40e13e0b` merged the conversation
   topbar status chip as D433 after this branch was cut from `d57fc19e`, where
   D432 was the newest; the ADR id is the slug
   `context-inspector-compact-action`).

### File map

| File | Responsibility |
|---|---|
| `packages/shared/src/types/sessions.ts` | `ContextCompactionMark` gains `tokensBefore?: number` |
| `packages/shared/src/context-compaction.ts` | derives the mark from the durable record |
| `packages/shared/src/context-compaction.test.ts` | vitest contract for the mark |
| `packages/agent-runtime/src/runtime.test.ts` | `compaction_end.mark` expectation |
| `apps/desktop/src/features/chat/transcript/AssistantTurn.tsx` | mark memo equality |
| `apps/desktop/src/lib/assistant-turns.ts` | transcript-entry mark reuse equality |
| `apps/desktop/src/components/ContextUsageInspector.tsx` | action row, before-line, busy/blocked states |
| `apps/desktop/src/features/chat/composer/ComposerToolbar.tsx` | passes `compactBlocked` |
| `apps/desktop/src/styles/messages.css` | action row + before-line styles |
| `packages/i18n/src/locales/*/index.ts` | 5 new `chat.*` keys × 8 locales |
| `apps/desktop/test/context-compaction.test.mjs` | source-contract test for the above |
| `apps/desktop/test/assistant-turns.test.mjs` | behavioral reuse test for the new mark field |
| `apps/desktop/src/capture/capture-rig.ts` | new `seedContextInspectorCompaction` fixture |
| `apps/desktop/src/capture/renderer-api.ts` | whitelists the new fixture |
| `scripts/e2e-context-inspector-compact.mjs` | CDP E2E for `E2E-CHAT-compact-from-context-inspector` |
| `package.json` | `test:e2e:inspector-compact` script |
| `docs/spec/04-ux/08-component-spec.md` + zh-CN | inspector action row |
| `docs/spec/04-ux/09-interaction-patterns.md` + zh-CN | checkpoint "before" figure, action behavior |
| `docs/spec/03-runtime/01-ipc-protocol.md` + zh-CN | `compaction_end.mark.tokensBefore` |
| `docs/adr/context-inspector-compact-action.md` + `0103-…` + `0106-…` + indexes | ADR |
| `docs/spec/08-meta/decisions-log.md` + zh-CN | D434 entry |
| `docs/spec/06-delivery/04-e2e-test-plan.md` + zh-CN | E2E scenario + suite rows |

---

### Task 1: Environment and baseline

Local `main` moved to `d57fc19e` (D432, the floating retry reason card) after
this worktree branched from `b9f621ed`. D432 edits two files this plan touches —
`apps/desktop/src/components/ContextUsageInspector.tsx` (renames the popover
placement import to `placeAnchoredPopover` / `AnchoredPopoverPlacement` from
`../lib/anchored-popover-position`) and `apps/desktop/src/styles/messages.css`
(retry-card region only, ~line 333). Rebasing first keeps every snippet below
applicable to the file actually on disk and avoids a late conflict; none of this
plan's steps touch the renamed import or the retry-card region.

The worktree is fresh: no `node_modules`, no `dist`, no `out`. `pnpm build:js`
is required before any package test, because `packages/agent-runtime` tests
import the built `@pi-desktop/shared` output.

**Files:** none (environment only).

- [ ] **Step 1: Rebase onto current local main**

```bash
git fetch . main
git rebase main
```

Expected: the branch replays the single design-doc commit `3e96976a` onto
`d57fc19e` with no conflicts. (The design doc is a new file; D432 does not touch
it.)

- [ ] **Step 2: Install dependencies**

```bash
pnpm install --frozen-lockfile
```

Expected: `Done` (repeatable install). If Electron's postinstall download times
out, set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` and retry
(project memory `packaging-github-timeout`).

- [ ] **Step 3: Build the JS packages**

```bash
pnpm build:js
```

Expected: every workspace package reports its build command without error.

- [ ] **Step 4: Record the baseline**

```bash
pnpm --filter @pi-desktop/shared test
pnpm --filter @pi-desktop/desktop test
pnpm --filter @pi-desktop/desktop typecheck
```

Expected: all three pass on the rebased base. If one fails, stop and report —
the task starts from a red baseline.

No commit (nothing changed).

---

### Task 2: The mark carries the pre-compaction occupancy

Commit 1. Deliverable: `compaction_end.mark` and restored marks carry
`tokensBefore`, and both renderer memo comparisons follow it.

**Files:**
- Modify: `packages/shared/src/types/sessions.ts` (~line 106)
- Modify: `packages/shared/src/context-compaction.ts:34-44`
- Test: `packages/shared/src/context-compaction.test.ts`
- Test: `packages/agent-runtime/src/runtime.test.ts:5132`
- Modify: `apps/desktop/src/features/chat/transcript/AssistantTurn.tsx:82-93`
- Modify: `apps/desktop/src/lib/assistant-turns.ts:327-336`

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/context-compaction.test.ts`, replace the
`contextCompactionMark` describe block (lines 47-64) with:

```ts
describe("contextCompactionMark", () => {
  it("describes one compaction for its transcript row and the inspector", () => {
    expect(contextCompactionMark(record({ details: { generation: 3 } }))).toEqual({
      id: "checkpoint-1",
      throughMessageId: "m9",
      generation: 3,
      summaryTokens: 100,
      summarized: true,
      tokensBefore: 120_000,
    });
  });

  it("carries the occupancy the checkpoint replaced", () => {
    expect(
      contextCompactionMark(record({ tokensBefore: 92_000 })).tokensBefore,
    ).toBe(92_000);
  });

  it("marks a rollover checkpoint as carrying no real summary", () => {
    expect(
      contextCompactionMark(record({ details: { strategy: "fresh_window" } }))
        .summarized,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @pi-desktop/shared test
```

Expected: FAIL — the exact `toEqual` reports a missing `tokensBefore` property.

- [ ] **Step 3: Add the field to the mark type**

In `packages/shared/src/types/sessions.ts`, extend `ContextCompactionMark`
(currently ends with the `summarized` line):

```ts
export type ContextCompactionMark = ContextCompactionStatus & {
  id: string;
  /** Last message the checkpoint covers; the row renders right after it. */
  throughMessageId: string;
  /** False when the window rolled over without asking for a summary. */
  summarized: boolean;
  /**
   * Context occupancy the checkpoint replaced. The durable record always
   * carries it; optional here because a mark can also arrive from a runtime
   * build older than the reader (version skew during dev).
   */
  tokensBefore?: number;
};
```

- [ ] **Step 4: Fill it from the record**

In `packages/shared/src/context-compaction.ts`, add the field to the returned
object:

```ts
export function contextCompactionMark(
  record: ContextCompactionRecord,
): ContextCompactionMark {
  return {
    id: record.id,
    throughMessageId: record.throughMessageId,
    generation: checkpointGeneration(record.details),
    summaryTokens: estimateSummaryTokens(record.summary ?? ""),
    summarized: checkpointSummarized(record.details),
    tokensBefore: record.tokensBefore,
  };
}
```

- [ ] **Step 5: Update the runtime event expectation**

In `packages/agent-runtime/src/runtime.test.ts` (~line 5132), add the field to
the `mark` object of the `compaction_end` expectation:

```ts
        mark: {
          id: expect.any(String),
          throughMessageId: "recent-user",
          generation: 1,
          summaryTokens: 7,
          summarized: true,
          tokensBefore: expect.any(Number),
        },
```

- [ ] **Step 6: Follow the field in both memo comparisons**

In `apps/desktop/src/features/chat/transcript/AssistantTurn.tsx`, extend
`compactionMarksEqual` (line 82):

```ts
export function compactionMarksEqual(
  previous: ContextCompactionMark,
  next: ContextCompactionMark,
): boolean {
  return (
    previous.id === next.id &&
    previous.throughMessageId === next.throughMessageId &&
    previous.generation === next.generation &&
    previous.summaryTokens === next.summaryTokens &&
    previous.summarized === next.summarized &&
    previous.tokensBefore === next.tokensBefore
  );
}
```

In `apps/desktop/src/lib/assistant-turns.ts`, extend the inline comparison in
`reuseTranscriptEntry` (line 327):

```ts
  if (previous.kind === "compaction" && next.kind === "compaction") {
    return previous.mark === next.mark ||
      (previous.mark.id === next.mark.id &&
        previous.mark.throughMessageId === next.mark.throughMessageId &&
        previous.mark.generation === next.mark.generation &&
        previous.mark.summaryTokens === next.mark.summaryTokens &&
        previous.mark.summarized === next.mark.summarized &&
        previous.mark.tokensBefore === next.mark.tokensBefore)
      ? previous
      : next;
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @pi-desktop/shared test
pnpm --filter @pi-desktop/agent-runtime test
pnpm --filter @pi-desktop/desktop typecheck
```

Expected: all pass. (`agent-runtime` needs the `pnpm build:js` output from
Task 1; rerun it first if TypeScript reports unresolved `@pi-desktop/shared`.)

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types/sessions.ts packages/shared/src/context-compaction.ts packages/shared/src/context-compaction.test.ts packages/agent-runtime/src/runtime.test.ts apps/desktop/src/features/chat/transcript/AssistantTurn.tsx apps/desktop/src/lib/assistant-turns.ts
git commit -m "feat(chat): carry the pre-compaction occupancy in the checkpoint mark"
```

---

### Task 3: The inspector card starts and reports a compaction

Commit 2. Deliverable: the popover has a bottom action row that starts a manual
compaction, shows the busy phase, refuses while a run is live, and renders the
"before this compaction" figure in place.

**Files:**
- Modify: `apps/desktop/src/components/ContextUsageInspector.tsx`
- Modify: `apps/desktop/src/features/chat/composer/ComposerToolbar.tsx:234`
- Modify: `apps/desktop/src/styles/messages.css` (after line 1604)
- Modify: `packages/i18n/src/locales/{en,zh-CN,zh-TW,tr,ko,fr,es,de}/index.ts`
- Test: `apps/desktop/test/context-compaction.test.mjs`

- [ ] **Step 1: Write the failing source-contract test**

In `apps/desktop/test/context-compaction.test.mjs`, extend the helper imports
(line 1-7) with `readComposerSource`:

```js
import {
  readStoreSource,
  readStoreModule,
  readTranscriptSource,
  readComposerSource,
  readMainSource,
  readSharedTypesSource,
} from "./helpers/source-contracts.mjs";
```

Extend the `Promise.all` list (line 32-51) with the composer bundle and the
zh-CN catalog, after `enLocale`:

```js
  enLocale,
  composer,
  zhCnLocale,
] = await Promise.all([
  ...
  read("../../../packages/i18n/src/locales/en/index.ts"),
  readComposerSource(),
  read("../../../packages/i18n/src/locales/zh-CN/index.ts"),
]);
```

Add this test block at the end of the file:

```js
test("the inspector card starts a compaction and reports it in place", () => {
  // The card is both the entry point and the result surface (D434): the action
  // row starts a manual compaction, the runtime's own activity phase drives the
  // busy presentation, and the checkpoint line gains the occupancy the
  // checkpoint replaced.
  assert.match(inspector, /compactBlocked = false/);
  assert.match(
    inspector,
    /state\.agentStatuses\[state\.activeSessionId\]\?\.activity\?\.phase/,
  );
  assert.match(inspector, /=== "compacting"/);
  assert.match(inspector, /state\.compactContext/);
  assert.match(inspector, /className="context-inspector-actions"/);
  assert.match(inspector, /chat\.usageCompactHint/);
  assert.match(inspector, /chat\.usageCompactBusyHint/);
  assert.match(inspector, /chat\.usageCompactAction/);
  assert.match(inspector, /chat\.usageCompactBusy/);
  assert.match(inspector, /aria-busy=\{compacting\}/);
  assert.match(inspector, /disabled=\{compactBlocked \|\| compacting\}/);
  assert.match(inspector, /onClick=\{\(\) => void compactContext\(\)\}/);
  assert.match(inspector, /compaction\?\.tokensBefore !== undefined/);
  assert.match(inspector, /chat\.usageCompactionBefore/);
  // The composer hands the card the run/approval block, so a compaction can
  // never race a live turn or a native session.
  assert.match(composer, /compactBlocked=\{controlsBlocked \|\| runActive\}/);
  // The mark carries the figure and both memo comparisons follow it.
  assert.match(types, /tokensBefore\?: number/);
  assert.match(transcript, /previous\.tokensBefore === next\.tokensBefore/);
  assert.match(turns, /previous\.mark\.tokensBefore === next\.mark\.tokensBefore/);
  assert.match(styles, /\.context-inspector-actions \{/);
  assert.match(styles, /\.context-inspector-compact-action \{/);
  assert.match(enLocale, /usageCompactAction: "Compact context"/);
  assert.match(enLocale, /usageCompactionBefore: "Before this compaction"/);
  assert.match(zhCnLocale, /usageCompactAction: "压缩上下文"/);
  assert.match(zhCnLocale, /usageCompactionBefore: "本次压缩前占用"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @pi-desktop/desktop test
```

Expected: FAIL — `compactionMarksEqual`/mark assertions from Task 2 already
pass, the new block reports the missing `compactBlocked`, the action row, and
the locale keys.

- [ ] **Step 3: Widen the component props**

In `apps/desktop/src/components/ContextUsageInspector.tsx`, replace the
signature (lines 38-54) so the card can learn that a run owns the composer:

```tsx
export function ContextUsageInspector({
  usage,
  turnUsage,
  contextWindow,
  tools,
  responseDurationMs,
  responseOutputTokens,
  responseOutputEstimated = false,
  compactBlocked = false,
}: {
  usage: MessageUsage;
  turnUsage: MessageUsage;
  contextWindow: number;
  tools: UiMessage[];
  responseDurationMs?: number;
  responseOutputTokens?: number;
  responseOutputEstimated?: boolean;
  /** A live turn or a native session owns the composer; compaction must wait. */
  compactBlocked?: boolean;
}) {
```

- [ ] **Step 4: Read the busy phase and the store action**

Directly after the existing `compaction` selector (line 63), add:

```tsx
  // Compaction is a turn-boundary operation and the runtime owns the busy
  // signal, so the card holds no local in-flight state of its own.
  const compacting = useAppStore(
    (state) =>
      (state.activeSessionId
        ? state.agentStatuses[state.activeSessionId]?.activity?.phase
        : undefined) === "compacting",
  );
  const compactContext = useAppStore((state) => state.compactContext);
```

- [ ] **Step 5: Add the "before" line under the checkpoint line**

Replace the compaction block (lines 355-362) with:

```tsx
      {compaction ? (
        <div className="context-inspector-compaction">
          <span>
            {t("chat.usageCompaction", { times: compaction.generation })}
          </span>
          <strong>~{formatTokenCount(compaction.summaryTokens)}</strong>
        </div>
      ) : null}
      {compaction?.tokensBefore !== undefined ? (
        <div className="context-inspector-compaction context-inspector-compaction-before">
          <span>{t("chat.usageCompactionBefore")}</span>
          <strong>~{formatTokenCount(compaction.tokensBefore)}</strong>
        </div>
      ) : null}
```

- [ ] **Step 6: Add the action row**

Immediately before the closing `</div>` of the popover (after the block from
Step 5, line ~363), insert the action row:

```tsx
      <div className="context-inspector-actions">
        <span className="context-inspector-actions-hint">
          {t(compacting ? "chat.usageCompactBusyHint" : "chat.usageCompactHint")}
        </span>
        <TooltipButton
          type="button"
          className="btn btn-primary context-inspector-compact-action"
          tooltip={t("chat.usageCompactAction")}
          ariaLabel={t("chat.usageCompactAction")}
          aria-busy={compacting}
          disabled={compactBlocked || compacting}
          onClick={() => void compactContext()}
        >
          {compacting ? (
            <>
              <span className="tool-spinner" aria-hidden="true" />
              <span>{t("chat.usageCompactBusy")}</span>
            </>
          ) : (
            <span>{t("chat.usageCompactAction")}</span>
          )}
        </TooltipButton>
      </div>
```

- [ ] **Step 7: Give the popover a real height dependency**

The popover's placement effect depends on the rendered content; the action row
adds a row whose height does not depend on any value in the dependency list.
Add `compacting` to the `useLayoutEffect` dependency array (line 174-184), next
to `compaction`:

```tsx
  }, [
    compaction,
    compacting,
    context.usedTokens,
    contextWindow,
    open,
    toolRows.length,
    toolTotal,
    turnTotal,
    throughput,
    updatePopoverPosition,
  ]);
```

- [ ] **Step 8: Pass the block from the composer toolbar**

In `apps/desktop/src/features/chat/composer/ComposerToolbar.tsx`, line 234:

```tsx
        {contextUsage ? (
          <ContextUsageInspector
            {...contextUsage}
            compactBlocked={controlsBlocked || runActive}
          />
        ) : null}
```

- [ ] **Step 9: Style the action row**

In `apps/desktop/src/styles/messages.css`, directly after the
`.context-inspector-compaction strong` rule (line 1602-1605), add:

```css
/* The before-figure belongs to the checkpoint line above it, so it sits
 * closer than the popover's spaced sections (D297). */
.context-inspector-compaction-before {
  margin-top: 6px;
}

/* One full-width action row: a muted hint and the compact action, set apart
 * from the readout above by space and a hairline. */
.context-inspector-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  border-top: 1px solid var(--ds-border-subtle);
  padding-top: 12px;
}

.context-inspector-actions-hint {
  flex: 1;
  min-width: 0;
  color: var(--ds-text-muted);
  font-size: var(--text-2xs);
  line-height: var(--leading-compact-plus);
}

.context-inspector-compact-action {
  flex: 0 0 auto;
  padding: 4px 10px;
  font-size: var(--text-xs);
  white-space: nowrap;
}

/* `.tool-spinner` is right-aligned for tool rows; inside the button it leads
 * the label, and on the accent fill it reads from the label's own color. */
.context-inspector-compact-action .tool-spinner {
  margin-left: 0;
  border-color: color-mix(in oklab, currentColor 45%, transparent);
  border-top-color: currentColor;
}
```

(`.btn` already supplies `inline-flex`, `align-items: center`, `gap: 6px`, and
the radius; only the compact padding/type size are overridden. All typography
values are tokens — `scripts/check-style-tokens.mjs` rejects raw literals.)

- [ ] **Step 10: Add the five keys to all eight catalogs**

Insert the same block directly after the `usageCompaction` line in each locale
file, keeping that file's key-quoting style (`fr`, `es`, `de` quote every key;
the rest do not). The `usageCompaction` anchor is at: en 376, zh-CN 371,
zh-TW 371, tr 378, ko 378, fr 369, es 369, de 369.

`packages/i18n/src/locales/en/index.ts`:

```ts
    usageCompactionBefore: "Before this compaction",
    usageCompactAction: "Compact context",
    usageCompactBusy: "Compacting…",
    usageCompactHint:
      "Compaction creates a checkpoint summary and keeps recent messages",
    usageCompactBusyHint: "Generating checkpoint summary…",
```

`packages/i18n/src/locales/zh-CN/index.ts`:

```ts
    usageCompactionBefore: "本次压缩前占用",
    usageCompactAction: "压缩上下文",
    usageCompactBusy: "压缩中…",
    usageCompactHint: "压缩会生成检查点摘要，保留最近消息",
    usageCompactBusyHint: "正在生成检查点摘要…",
```

`packages/i18n/src/locales/zh-TW/index.ts`:

```ts
    usageCompactionBefore: "本次壓縮前佔用",
    usageCompactAction: "壓縮上下文",
    usageCompactBusy: "壓縮中…",
    usageCompactHint: "壓縮會產生檢查點摘要，保留最近訊息",
    usageCompactBusyHint: "正在產生檢查點摘要…",
```

`packages/i18n/src/locales/tr/index.ts`:

```ts
    usageCompactionBefore: "Bu sıkıştırmadan önce",
    usageCompactAction: "Bağlamı sıkıştır",
    usageCompactBusy: "Sıkıştırılıyor…",
    usageCompactHint:
      "Sıkıştırma bir kontrol noktası özeti oluşturur ve son mesajları korur",
    usageCompactBusyHint: "Kontrol noktası özeti oluşturuluyor…",
```

`packages/i18n/src/locales/ko/index.ts`:

```ts
    usageCompactionBefore: "이번 압축 전 사용량",
    usageCompactAction: "컨텍스트 압축",
    usageCompactBusy: "압축 중…",
    usageCompactHint: "압축은 체크포인트 요약을 만들고 최근 메시지를 유지합니다",
    usageCompactBusyHint: "체크포인트 요약 생성 중…",
```

`packages/i18n/src/locales/fr/index.ts`:

```ts
    "usageCompactionBefore": "Avant ce compactage",
    "usageCompactAction": "Compacter le contexte",
    "usageCompactBusy": "Compactage…",
    "usageCompactHint":
      "Le compactage crée un résumé de point de contrôle et conserve les messages récents",
    "usageCompactBusyHint": "Génération du résumé de point de contrôle…",
```

`packages/i18n/src/locales/es/index.ts`:

```ts
    "usageCompactionBefore": "Antes de esta compactación",
    "usageCompactAction": "Compactar contexto",
    "usageCompactBusy": "Compactando…",
    "usageCompactHint":
      "La compactación crea un resumen de punto de control y conserva los mensajes recientes",
    "usageCompactBusyHint": "Generando el resumen del punto de control…",
```

`packages/i18n/src/locales/de/index.ts`:

```ts
    "usageCompactionBefore": "Vor dieser Verdichtung",
    "usageCompactAction": "Kontext verdichten",
    "usageCompactBusy": "Wird verdichtet…",
    "usageCompactHint":
      "Verdichtung erstellt eine Checkpoint-Zusammenfassung und behält die neuesten Nachrichten",
    "usageCompactBusyHint": "Checkpoint-Zusammenfassung wird erstellt…",
```

- [ ] **Step 11: Run the checks to verify they pass**

```bash
pnpm --filter @pi-desktop/desktop test
pnpm --filter @pi-desktop/desktop typecheck
pnpm --filter @pi-desktop/desktop lint
pnpm lint:biome
```

Expected: all pass. `pnpm --filter @pi-desktop/desktop test` now includes the
new block; typecheck proves the catalog record type accepted all five keys in
all eight locales.

- [ ] **Step 12: Commit**

```bash
git add apps/desktop/src/components/ContextUsageInspector.tsx apps/desktop/src/features/chat/composer/ComposerToolbar.tsx apps/desktop/src/styles/messages.css packages/i18n/src/locales apps/desktop/test/context-compaction.test.mjs
git commit -m "feat(chat): compact context from the inspector card"
```

---

### Task 4: Drive the action row over CDP

Commit 3. Deliverable: `E2E-CHAT-compact-from-context-inspector` runs against a
real build with a throwaway profile, and the capture rig can seed the inspector
scene.

**Files:**
- Modify: `apps/desktop/src/capture/capture-rig.ts` (type at line 25-49, methods at 67+, `dispose` at 1095+)
- Modify: `apps/desktop/src/capture/renderer-api.ts:46-62`
- Create: `scripts/e2e-context-inspector-compact.mjs`
- Modify: `package.json` (root scripts)

- [ ] **Step 1: Add the fixture to the rig**

In `apps/desktop/src/capture/capture-rig.ts`, add to `CaptureRigMethods` (after
`seedTranscript`):

```ts
  seedContextInspectorCompaction: (options?: {
    mark?: "compacted" | "legacy" | "none";
    phase?: "idle" | "compacting";
    running?: boolean;
  }) => void;
```

Add the implementation to `methods`, after `seedTranscript` (line 158):

```ts
    seedContextInspectorCompaction: (options = {}) => {
      // Capture-only inspector fixture (context popover scenes and the
      // E2E-CHAT-compact-from-context-inspector run). `api.compact` is
      // replaced with a recorder because the synthetic transcript never
      // reaches the host, so a real round trip would fail by construction.
      if (!window.__PI_CAPTURE__) return;
      const { mark = "compacted", phase = "idle", running = false } = options;
      const sessionId =
        useAppStore.getState().activeSessionId ?? "capture-inspector-session";
      const base = Date.parse("2026-07-20T09:00:00Z");
      const busy = phase === "compacting" || running;
      // The E2E asserts the recorded call names this session.
      (window as { __PI_INSPECTOR_SESSION__?: string }).__PI_INSPECTOR_SESSION__ =
        sessionId;
      api.compact = async (request) => {
        (window as { __PI_COMPACT_CALLS__?: unknown[] }).__PI_COMPACT_CALLS__ = [
          ...((window as { __PI_COMPACT_CALLS__?: unknown[] })
            .__PI_COMPACT_CALLS__ ?? []),
          request,
        ];
      };
      useAppStore.setState((state) => ({
        activeSessionId: sessionId,
        messages: [
          {
            id: "capture-inspector-user",
            role: "user",
            content: "把压缩入口加到上下文卡片里",
            createdAt: new Date(base).toISOString(),
            status: "complete",
          },
          {
            id: "capture-inspector-assistant",
            role: "assistant",
            content: "先看一眼卡片现在的结构。",
            createdAt: new Date(base + 60_000).toISOString(),
            status: "complete",
            responseDurationMs: 76_000,
            usage: {
              inputTokens: 38_000,
              outputTokens: 6_200,
              totalTokens: 44_200,
              cacheReadTokens: 30_000,
            },
          },
        ],
        sessionCompactions: {
          ...state.sessionCompactions,
          [sessionId]:
            mark === "none"
              ? []
              : [
                  {
                    id: "capture-checkpoint-1",
                    throughMessageId: "capture-inspector-assistant",
                    generation: 3,
                    summaryTokens: 4_200,
                    summarized: true,
                    ...(mark === "compacted" ? { tokensBefore: 92_000 } : {}),
                  },
                ],
        },
        agentStatuses: {
          ...state.agentStatuses,
          [sessionId]: {
            sessionId,
            isRunning: busy,
            pendingToolConfirmations: 0,
            ...(phase === "compacting"
              ? {
                  activity: {
                    phase: "compacting" as const,
                    since: Date.now(),
                    reason: "manual" as const,
                  },
                }
              : {}),
          },
        },
        isRunning: busy,
        runningSessions: { ...state.runningSessions, [sessionId]: busy },
      }));
    },
```

At the top of `installCaptureRig`, capture the original for restore (next to
`originalListPluginServices`, line 59):

```ts
  const originalCompact = api.compact;
```

In `dispose()` (line 1095), restore it next to the other restores:

```ts
      api.compact = originalCompact;
```

- [ ] **Step 2: Whitelist the fixture**

In `apps/desktop/src/capture/renderer-api.ts`, add the name to
`CAPTURE_RIG_METHODS` after `"seedTranscript"`:

```ts
  "seedContextInspectorCompaction",
```

- [ ] **Step 3: Write the E2E script**

Create `scripts/e2e-context-inspector-compact.mjs`:

```js
#!/usr/bin/env node
/**
 * E2E-CHAT-compact-from-context-inspector.
 *
 * Launches the built desktop app with a throwaway profile and drives the
 * renderer over CDP: seeds the inspector fixture, opens the context popover,
 * clicks the compact action, and asserts the contract:
 *
 *   - idle: the action row carries a hint and an enabled button;
 *   - click: `api.compact` receives the active session id and the popover
 *     stays open — the card is both the trigger and the result surface;
 *   - busy: the runtime's `compacting` activity disables the button and swaps
 *     the label and hint;
 *   - blocked: a running session disables the button without the busy state;
 *   - the checkpoint line renders the pre-compaction occupancy only when the
 *     mark carries it; a legacy mark degrades to the single line.
 *
 * Prereqs: `pnpm --filter @pi-desktop/desktop build` (or `pnpm build:js`) and a
 * host-core binary (target/debug, target/release, or PI_DESKTOP_HOST_BIN).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertDesktopBuild,
  createTempDataDir,
  repositoryRoot,
  resolveElectronBinary,
} from "./e2e/boot.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";

const root = repositoryRoot();
const cdpPort = Number(process.env.PI_DESKTOP_INSPECTOR_CDP_PORT || 9341);
const { appDir, electronBinary } = resolveElectronBinary(root);

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.console = [];
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (
        message.method === "Runtime.consoleAPICalled" ||
        message.method === "Runtime.exceptionThrown"
      ) {
        this.console.push(
          `[${message.method}] ${JSON.stringify(message.params).slice(0, 400)}`,
        );
        if (this.console.length > 40) this.console.shift();
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    };
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onerror = () => reject(new Error(`CDP websocket failed: ${url}`));
      ws.onopen = () => resolve(new CdpClient(ws));
    });
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          JSON.stringify(result.exceptionDetails),
      );
    }
    return result.result.value;
  }
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2_000),
  });
  return response.json();
}

async function waitFor(predicate, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(
    `timeout waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`,
  );
}

const READ_ROW = `(() => {
  const row = document.querySelector(".context-inspector-actions");
  const button = document.querySelector(".context-inspector-compact-action");
  const before = document.querySelector(".context-inspector-compaction-before");
  return {
    popoverOpen: !!document.querySelector(".context-inspector-popover"),
    row: !!row,
    hint: row?.querySelector(".context-inspector-actions-hint")?.textContent?.trim() ?? null,
    label: button?.textContent?.trim() ?? null,
    disabled: button ? button.disabled : null,
    ariaBusy: button?.getAttribute("aria-busy") ?? null,
    spinner: !!button?.querySelector(".tool-spinner"),
    before: before ? before.textContent.trim() : null,
    compactionRows: document.querySelectorAll(".context-inspector-compaction").length,
  };
})()`;

const results = [];
function check(ok, label, detail = "") {
  results.push({ ok, label, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

let activeCdp = null;

async function main() {
  assertDesktopBuild(root);
  const hostBinary = resolveHostBinary();
  const dataDir = createTempDataDir("pi-inspector-data-");
  const profileDir = mkdtempSync(join(tmpdir(), "pi-inspector-profile-"));
  const child = spawn(
    electronBinary,
    [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, "."],
    {
      cwd: appDir,
      env: {
        ...process.env,
        PI_DESKTOP_DATA_DIR: dataDir,
        PI_DESKTOP_HOST_BIN: hostBinary,
        PI_DESKTOP_START_MAXIMIZED: "0",
        ELECTRON_RENDERER_URL: "",
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const collect = (chunk) => {
    output += String(chunk);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  const cleanup = () => {
    try {
      if (process.platform === "win32" || !child.pid) child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch {}
    for (const dir of [dataDir, profileDir]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  };

  const timeout = setTimeout(() => {
    console.error("FAIL inspector compact — timeout after 180s");
    console.error(output.slice(-2_000));
    cleanup();
    process.exit(1);
  }, 180_000);

  try {
    const target = await waitFor(async () => {
      const targets = await listTargets(cdpPort).catch(() => []);
      return targets.find(
        (candidate) =>
          candidate.type === "page" &&
          candidate.webSocketDebuggerUrl &&
          candidate.url.includes("out/renderer/index.html") &&
          !candidate.url.includes("surface="),
      );
    }, "main window CDP target");

    const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    activeCdp = cdp;
    await cdp.send("Runtime.enable");
    const evaluate = (expression) => cdp.evaluate(expression);
    const seed = async (options) => {
      await evaluate(
        `(async () => { window.__PI_CAPTURE__ = 1; await window.__PI_DESKTOP__.seedContextInspectorCompaction(${JSON.stringify(options)}); })()`,
      );
      await delay(420);
    };

    await waitFor(
      () => evaluate(`!document.querySelector(".startup-splash")`),
      "startup splash cleared",
    );
    await evaluate(`window.__PI_CAPTURE__ = 1; window.__PI_DESKTOP__.ensureVisualFixtures()`);
    await waitFor(
      () =>
        evaluate(
          `document.querySelector(".app-work-panel-toggle")?.disabled === false`,
        ),
      "session selected by the visual fixtures",
    );

    // 1. Idle: the row offers the action and the newest checkpoint's figures.
    await seed({ mark: "compacted", phase: "idle" });
    await waitFor(
      () => evaluate(`!!document.querySelector(".context-inspector-trigger")`),
      "inspector trigger",
    );
    await evaluate(`document.querySelector(".context-inspector-trigger").click()`);
    await waitFor(
      () => evaluate(`!!document.querySelector(".context-inspector-popover")`),
      "inspector popover",
    );
    const idle = await evaluate(READ_ROW);
    check(
      idle.row && idle.hint && idle.label && idle.disabled === false,
      "the idle card offers an enabled compact action with a hint",
      JSON.stringify(idle),
    );
    check(
      idle.ariaBusy === "false" && idle.spinner === false,
      "the idle action carries no busy state",
      JSON.stringify(idle),
    );
    check(
      idle.compactionRows === 2 && /~92k/.test(idle.before ?? ""),
      "the checkpoint line shows the pre-compaction occupancy",
      JSON.stringify(idle),
    );

    // 2. Clicking spends the existing store action and keeps the card open.
    const expectedSessionId = await evaluate(
      `window.__PI_INSPECTOR_SESSION__ ?? null`,
    );
    await evaluate(
      `document.querySelector(".context-inspector-compact-action").click()`,
    );
    await waitFor(
      () => evaluate(`(window.__PI_COMPACT_CALLS__ ?? []).length > 0`),
      "compact call recorded",
    );
    const calls = JSON.parse(
      await evaluate(`JSON.stringify(window.__PI_COMPACT_CALLS__ ?? [])`),
    );
    const clicked = await evaluate(READ_ROW);
    check(
      !!expectedSessionId &&
        calls.length === 1 &&
        calls[0]?.sessionId === expectedSessionId,
      "clicking the action asks the host to compact the active session",
      JSON.stringify(calls),
    );
    check(
      clicked.popoverOpen,
      "the popover stays open across the action",
      JSON.stringify(clicked),
    );

    // 3. Busy: the runtime's own compacting phase drives label and hint.
    await seed({ mark: "compacted", phase: "compacting" });
    const busy = await evaluate(READ_ROW);
    check(
      busy.disabled === true &&
        busy.ariaBusy === "true" &&
        busy.spinner === true &&
        busy.label !== idle.label &&
        busy.hint !== idle.hint,
      "a compacting session disables the action and swaps label and hint",
      JSON.stringify(busy),
    );

    // 4. Blocked: a live run refuses the action without the busy state.
    await seed({ mark: "compacted", running: true });
    const blocked = await evaluate(READ_ROW);
    check(
      blocked.disabled === true &&
        blocked.spinner === false &&
        blocked.label === idle.label &&
        blocked.hint === idle.hint,
      "a running session disables the action and keeps the idle copy",
      JSON.stringify(blocked),
    );

    // 5. A legacy mark degrades to the single checkpoint line.
    await seed({ mark: "legacy", phase: "idle" });
    const legacy = await evaluate(READ_ROW);
    check(
      legacy.compactionRows === 1 && legacy.before === null,
      "a mark without the figure degrades to the checkpoint line alone",
      JSON.stringify(legacy),
    );

    // 6. No checkpoint at all: the action row still stands alone.
    await seed({ mark: "none", phase: "idle" });
    const none = await evaluate(READ_ROW);
    check(
      none.compactionRows === 0 && none.row === true && none.disabled === false,
      "the action row renders without any checkpoint",
      JSON.stringify(none),
    );

    const failed = results.filter((entry) => !entry.ok);
    for (const entry of failed) console.error(`FAIL ${entry.label} — ${entry.detail}`);
    cleanup();
    clearTimeout(timeout);
    if (failed.length > 0) {
      console.error(`FAIL inspector compact — ${failed.length} of ${results.length} checks failed`);
      process.exit(1);
    }
    console.log(`PASS inspector compact — ${results.length} checks`);
    process.exit(0);
  } catch (error) {
    console.error(`FAIL inspector compact — ${error.message}`);
    try {
      if (activeCdp) {
        console.error("--- renderer console tail ---");
        for (const line of activeCdp.console.slice(-12)) console.error(line);
      }
    } catch {}
    console.error(output.slice(-2_000));
    cleanup();
    clearTimeout(timeout);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Register the root script**

In the root `package.json`, after `"test:e2e:layout"`, add:

```json
    "test:e2e:inspector-compact": "node scripts/e2e-context-inspector-compact.mjs",
```

- [ ] **Step 5: Build and run the script**

```bash
pnpm --filter @pi-desktop/desktop build
pnpm --filter @pi-desktop/desktop test
pnpm test:e2e:inspector-compact
```

Expected: the script prints `PASS inspector compact — N checks` and exits 0.

**Fallback rule (mandatory):** if the script cannot be made to pass here — a
`check()` that reveals a product gap is a Task 3 bug and goes back there; an
environment failure (no host binary, port binding, occluded window) is *not*
worked around by weakening assertions. In that case, revert this task's changes
(`git checkout -- apps/desktop/src/capture package.json` and delete the new
script), record `E2E: NOT RUN` with the reason and remaining risk in the final
handoff, and describe the scenario in the E2E plan as manual verification.
Never commit a failing or flaky script.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/capture/capture-rig.ts apps/desktop/src/capture/renderer-api.ts scripts/e2e-context-inspector-compact.mjs package.json
git commit -m "test(e2e): drive the inspector compact action over CDP"
```

---

### Task 5: Synchronize the specs, the ADR, and the decision log

Commit 4. Deliverable: every observable surface of the change is documented in
English and in the zh-CN mirror.

**Files:**
- Modify: `docs/spec/04-ux/08-component-spec.md` + `docs/zh-CN/spec/04-ux/08-component-spec.md`
- Modify: `docs/spec/04-ux/09-interaction-patterns.md` + zh-CN
- Modify: `docs/spec/03-runtime/01-ipc-protocol.md` + zh-CN
- Create: `docs/adr/context-inspector-compact-action.md`
- Modify: `docs/adr/0103-compact-context-usage-summary.md`, `docs/adr/0106-core-five-builtin-commands.md`
- Modify: `docs/adr/README.md`, `docs/zh-CN/adr/index.md`
- Modify: `docs/spec/08-meta/decisions-log.md` + zh-CN
- Modify: `docs/spec/06-delivery/04-e2e-test-plan.md` + zh-CN

- [ ] **Step 1: Confirm the decision number is still free**

```bash
grep -n "D43[0-9]" docs/spec/08-meta/decisions-log.md | tail -5
```

Expected: the newest entry is `D432`. If another agent has since taken `D434`,
use the next free number everywhere below and note the substitution in the
commit message.

- [ ] **Step 2: Write the ADR**

Create `docs/adr/context-inspector-compact-action.md` (slug-file convention, like
`docs/adr/global-sidebar-pins.md`):

```markdown
# ADR: Compact the context from the usage inspector card

- Status: Accepted for implementation
- Date: 2026-09-17
- Deciders: PI-Desktop renderer and UX maintainers
- Amends: [ADR 0103](0103-compact-context-usage-summary.md), [ADR 0106](0106-core-five-builtin-commands.md)
- Related: ADR 0047, D225, D244, D434

## Context

Context compaction could only be started from `/compact`
(`builtin.agent.compact`) or the command palette. The context usage inspector —
the surface that shows how full the model context is — was read-only, so the
moment a user saw the context filling up was also the moment they had to
remember a slash command.

## Decision

The inspector popover card is both the entry point and the result surface.

1. A bottom action row (muted hint left, `Compact context` button right,
   separated by a hairline) starts a manual compaction by calling the existing
   store action `compactContext()` and the existing `agent.compact` IPC.
2. The busy state is derived, not stored: the button is disabled with a spinner
   and the busy label while
   `agentStatuses[activeSessionId].activity?.phase === "compacting"`, which the
   runtime already emits for both manual and automatic compactions.
3. The action is blocked while a live turn owns the composer
   (`controlsBlocked || runActive`), because compaction is a turn-boundary
   operation that the store action refuses on a running session.
4. The checkpoint line gains a persistent "before this compaction" figure.
   `ContextCompactionMark` gains optional `tokensBefore`, filled from the
   durable record's existing `tokensBefore` field, so the figure rides the
   existing `compaction_end` event and the restored `SessionDetail.compactions`
   path with no storage or schema change.
5. No confirmation step: compaction is non-destructive — it installs a
   checkpoint and keeps every message in the transcript.

## Consequences

- `/compact`, the palette, the toasts, and the transcript divider row are
  unchanged; the card adds a third entry point with the same side effects.
- Marks written by an older runtime lack `tokensBefore` and degrade to the
  single checkpoint line.
- The popover stays open across the action; the busy label, the updated
  checkpoint line, and the "before" line are the in-place feedback.

## Alternatives

- An inline button on the checkpoint line, or a header icon button: rejected in
  design — small hit target and weak affordance respectively.
- A confirmation dialog: rejected — compaction keeps every message, so there is
  no destructive outcome to confirm.
```

- [ ] **Step 3: Amend the two ADRs through their Status lines**

The repository records amendments in the amended ADR's own Status line
(`docs/adr/0050-…` reads `- Status: Accepted (amended by D259 and D378)`).

In `docs/adr/0103-compact-context-usage-summary.md`, line 3 becomes:

```markdown
- Status: Accepted (amended by D347 / ADR 0184 and D355 / ADR 0193; amended by D434 / [context-inspector-compact-action](context-inspector-compact-action.md))
```

In `docs/adr/0106-core-five-builtin-commands.md`, line 3 becomes:

```markdown
- Status: Accepted (amended by D434 / [context-inspector-compact-action](context-inspector-compact-action.md): compaction is also reachable from the context usage card, not slash-first alone)
```

- [ ] **Step 4: Index the ADR**

The English table is the full index (`| ID | Title | Status |`, slug ids allowed,
appended after the `0259` row at the end of the table in `docs/adr/README.md`):

```markdown
| context-inspector-compact-action | [Compact the context from the usage inspector card](context-inspector-compact-action.md) | Accepted (amends ADR 0103 / ADR 0106; D434) |
```

The zh-CN file mirrors the same table under `## 完整索引`
(`| 编号 | 标题 | 状态 |`, site-absolute links, Chinese status). Append after
its last row (`| 0259 | … |`):

```markdown
| context-inspector-compact-action | [从上下文用量卡片启动压缩](/adr/context-inspector-compact-action) | 已接受待实现（修订 ADR 0103 / ADR 0106；D434） |
```

Do **not** touch the zh-CN `## 重点决策` table — it is a curated shortlist, not
a mirror.

- [ ] **Step 5: Update the component spec (EN + zh-CN)**

In `docs/spec/04-ux/08-component-spec.md`, the inspector paragraph ends
"…the popover keeps its floating-layer edge and draws no inner section rules
(D297)." (~line 1591). Extend it with:

```markdown
The closing action row puts a muted hint and the `Compact context` button below
one hairline: the button starts a manual compaction through the existing
`compactContext()` store action, and stays disabled while a live turn or a
native session owns the composer. While the runtime reports
`activity.phase === "compacting"` the button shows a spinner with the busy
label and the hint switches to the checkpoint-summary copy.
```

Then, in the same file's inspector accessibility bullets (the block starting
"Context inspector trigger (composer toolbar) is keyboard focusable…",
~line 1650), add:

```markdown
- The compact action exposes the action label as its accessible name, carries
  `aria-busy="true"` while a compaction runs, and reports the blocked state
  through `disabled`.
```

Mirror both additions in `docs/zh-CN/spec/04-ux/08-component-spec.md` at the
matching sentences (`…（D297）。生成速度只代表已完成回合…` ~line 1138, and the
accessibility bullets ~line 1186-1191):

```markdown
收尾操作行在一条细分隔线下方放置提示文案与“压缩上下文”按钮：按钮通过既有的 `compactContext()` store 动作启动手动压缩；当有正在进行的回合或原生会话占用输入区时按钮禁用。运行时报告 `activity.phase === "compacting"` 时按钮显示加载图标与“压缩中…”文案，提示文案同步切换为检查点摘要说明。
```

```markdown
- 压缩按钮以动作名作为无障碍名称，压缩进行中带 `aria-busy="true"`，禁用状态通过 `disabled` 暴露。
```

- [ ] **Step 6: Update the interaction patterns (EN + zh-CN)**

In `docs/spec/04-ux/09-interaction-patterns.md` §3A, extend the checkpoint-line
bullet (lines 751-753):

```markdown
- The checkpoint line shows the generation count, the summary's estimated
  occupancy, and — when the newest checkpoint record carries it — the context
  occupancy the checkpoint replaced ("Before this compaction"). The card stays
  open across a compaction started from it: the busy label, the updated
  checkpoint line, and the before figure are the in-place feedback.
```

Mirror in `docs/zh-CN/spec/04-ux/09-interaction-patterns.md`:

```markdown
- 检查点行显示压缩次数、摘要的估算占用，并在最新检查点记录携带该值时显示被替换掉的上下文占用（“本次压缩前占用”）。从卡片内启动压缩后卡片保持打开：忙碌文案、更新后的检查点行与压缩前占用即为原地反馈。
```

- [ ] **Step 7: Update the IPC protocol docs (EN + zh-CN)**

In `docs/spec/03-runtime/01-ipc-protocol.md`, the `compaction_end` mark shape
(lines 647-654) gains the field, and the prose (702-709) gains one sentence:

```ts
    mark?: {
      id: string;
      throughMessageId: string;
      generation: number;
      summaryTokens: number;
      summarized: boolean;
      /** Context occupancy the checkpoint replaced. */
      tokensBefore?: number;
    };
```

```markdown
`mark.tokensBefore` is the occupancy the checkpoint replaced, copied from the
durable record's `tokensBefore`. It is additive and optional: a mark from an
older runtime omits it and the inspector hides the "before this compaction"
line.
```

Mirror in `docs/zh-CN/spec/03-runtime/01-ipc-protocol.md` at the corresponding
mark block and prose paragraph:

```ts
      /** 该检查点替换掉的上下文占用。 */
      tokensBefore?: number;
```

```markdown
`mark.tokensBefore` 为该检查点替换掉的上下文占用，直接取自持久化记录的 `tokensBefore`。该字段为可选的新增字段：旧运行时产生的标记不含它，此时检查器隐藏“本次压缩前占用”一行。
```

- [ ] **Step 8: Record the decision**

Append to `docs/spec/08-meta/decisions-log.md`:

```markdown
## 2026-09-17 — Compact from the context inspector card (D434)

The context usage inspector popover was read-only, so seeing the context fill
up and acting on it were two different surfaces. The card now carries a bottom
action row: a muted hint and a `Compact context` button that calls the existing
`compactContext()` store action and the existing `agent.compact` IPC — no new
channel, no new permission, no runtime change. The busy state is the runtime's
own `activity.phase === "compacting"`, the button is blocked while a live turn
or a native session owns the composer, and the popover stays open so the
updated checkpoint line is the in-place feedback. `ContextCompactionMark` gains
optional `tokensBefore`, filled from the durable record the host already
stores, so the checkpoint line can show the occupancy the checkpoint replaced;
older marks omit it and degrade to the single line. Renderer, docs, and tests
only: no IPC channel, Host RPC, storage schema, permission, or persisted-state
change.
```

Append the zh-CN mirror to `docs/zh-CN/spec/08-meta/decisions-log.md`:

```markdown
## 2026-09-17 — 从上下文卡片启动压缩 (D434)

上下文用量检查器此前是只读的，看到上下文变满和动手处理是两处界面。现在卡片底部新增操作行：左侧提示文案，右侧“压缩上下文”按钮，调用既有的 `compactContext()` store 动作与既有 `agent.compact` IPC —— 不新增渠道、不新增权限、不改运行时。忙碌状态直接取自运行时的 `activity.phase === "compacting"`；当有正在进行的回合或原生会话占用输入区时按钮禁用；压缩过程中卡片保持打开，更新后的检查点行即为原地反馈。`ContextCompactionMark` 新增可选 `tokensBefore`，取自宿主本就持久化的记录，使检查点行可以显示被替换掉的上下文占用；旧标记不含该字段时退化为单行。仅渲染器、文档与测试：不改 IPC 渠道、Host RPC、存储 schema、权限或持久化状态。
```

- [ ] **Step 9: Document the E2E scenario**

Semantic scenarios are appended at the end of the catalog in both locales — the
English file uses `#### <id>: <Title>` with `**Preconditions** / **Steps** /
**Expected** / **Specs linked** / **Acceptance**` bullets, the zh-CN file uses
`### <id>：<标题>` with `**前提条件** / **步骤** / **预期** / **链接规格** /
**验收**` and fullwidth punctuation.

Append to the end of `docs/spec/06-delivery/04-e2e-test-plan.md`:

```markdown
#### E2E-CHAT-compact-from-context-inspector: Compact from the context usage card

- **Preconditions**: A chat session with history is active and idle; the
  newest checkpoint record may or may not carry its pre-compaction occupancy.
- **Steps**: 1) Open the context usage popover. 2) Inspect the action row at
  the bottom of the card. 3) Click `Compact context`. 4) Observe the button
  and the popover while the runtime reports the compacting phase. 5) Repeat
  with a running turn, with a checkpoint whose record carries no occupancy,
  and with no checkpoint at all.
- **Expected**: The idle card shows the hint copy and an enabled button. The
  click calls `agent.compact` for the active session and the popover stays
  open. While `activity.phase === "compacting"` the button is disabled, carries
  `aria-busy="true"`, and shows a spinner with the busy label and hint. While a
  turn is live the button is disabled and keeps the idle copy. The checkpoint
  line shows the pre-compaction occupancy only when the newest mark carries
  `tokensBefore`; otherwise it degrades to the summary line alone, and with no
  checkpoint the action row still renders.
- **Specs linked**: `04-ux/08-component-spec.md`, `04-ux/09-interaction-patterns.md`,
  `03-runtime/01-ipc-protocol.md`, ADR context-inspector-compact-action
- **Acceptance**: C — Conversation & stream; Quality
- **Status**: Automated (CDP) — `pnpm test:e2e:inspector-compact`
```

Append to the end of `docs/zh-CN/spec/06-delivery/04-e2e-test-plan.md`:

```markdown
### E2E-CHAT-compact-from-context-inspector：从上下文用量卡片启动压缩

- **前提条件**：一个带历史记录的聊天会话处于活动且空闲状态；最新检查点记录可能带有、也可能不带有压缩前的占用。
- **步骤**：1) 打开上下文用量弹窗。2) 检查卡片底部操作行。3) 点击“压缩上下文”。4) 在运行时报告压缩阶段时观察按钮与弹窗。5) 分别在回合进行中、检查点记录不含占用、以及完全没有检查点三种情况下重复。
- **预期**：空闲卡片显示提示文案与可点击按钮。点击会以当前会话调用 `agent.compact`，弹窗保持打开。`activity.phase === "compacting"` 期间按钮禁用、带 `aria-busy="true"`，并显示加载图标与忙碌文案。回合进行中时按钮禁用且保持空闲文案。仅当最新标记含 `tokensBefore` 时检查点行显示压缩前占用，否则退化为仅摘要行；没有检查点时操作行仍然渲染。
- **链接规格**：`04-ux/08-component-spec.md`、`04-ux/09-interaction-patterns.md`、`03-runtime/01-ipc-protocol.md`、ADR context-inspector-compact-action
- **验收**：C —— 对话与流式；品质
- **状态**：自动化（CDP）—— `pnpm test:e2e:inspector-compact`
```

Then add the suite rows next to the existing manual compaction rows in
`docs/spec/06-delivery/04-e2e-test-plan.md` (~line 7264):

```markdown
| C — Conversation & stream (inspector compact action) | E2E-CHAT-compact-from-context-inspector |
| Quality (inspector compact action) | E2E-CHAT-compact-from-context-inspector |
```

and the mirrored rows in `docs/zh-CN/spec/06-delivery/04-e2e-test-plan.md`
(after the `手动压缩队列` rows at ~line 4861):

```markdown
| C — 对话与流式（检查器压缩操作） | E2E-CHAT-compact-from-context-inspector |
| 品质（检查器压缩操作） | E2E-CHAT-compact-from-context-inspector |
```

- [ ] **Step 10: Run the docs checks**

```bash
pnpm docs:check
pnpm check:release-docs 0.14.24
```

Expected: `docs:check` passes (locale parity for the docs site);
`check:release-docs` is only a sanity read of the current released version and
may report missing changelog entries for an unreleased bump — that is expected
here and is not a failure of this task.

- [ ] **Step 11: Commit**

```bash
git add docs
git commit -m "docs(spec): record compact from the context inspector card as D434"
```

---

### Task 6: Verify, integrate into local main, and clean up

- [ ] **Step 1: Full local verification on the branch**

```bash
pnpm build:js
pnpm --filter @pi-desktop/desktop build
pnpm --filter @pi-desktop/desktop test
pnpm --filter @pi-desktop/shared test
pnpm --filter @pi-desktop/agent-runtime test
pnpm --filter @pi-desktop/desktop typecheck
pnpm lint
```

Expected: everything passes. Fix and amend nothing retroactively — new commits
for new fixes.

- [ ] **Step 2: Run the E2E on the branch (exploratory)**

```bash
pnpm test:e2e:layout
pnpm test:e2e:inspector-compact
```

Expected: both pass. This run is exploratory only; the required run happens on
integrated `main` (AGENTS.md §15).

- [ ] **Step 3: Refresh against main and integrate**

```bash
git log --oneline -1 main
git rebase main
```

Then, from the primary checkout (`E:\pi-pro\PI-Desktop`):

```bash
git checkout main
git merge --no-ff feat/context-inspector-compact-action -m "merge: integrate compact from the context inspector (D434)"
```

Expected: a fast, conflict-free merge. If `main` moved, re-resolve inside the
worktree first. Record conflicts in the handoff if any.

- [ ] **Step 4: Run the required E2E on integrated main**

From the primary checkout on `main`:

```bash
pnpm build:js
pnpm --filter @pi-desktop/desktop build
pnpm test:e2e
pnpm test:e2e:transcript
pnpm test:e2e:inspector-compact
```

Expected: all pass. If the environment cannot run them, record
`E2E: NOT RUN` with suite, reason, alternative validation, and remaining risk
in the handoff — never claim a run that did not happen.

- [ ] **Step 5: Clean up the worktree and the branch**

```bash
git worktree remove .worktrees/feat/context-inspector-compact-action
git branch -d feat/context-inspector-compact-action
git worktree prune
```

- [ ] **Step 6: Handoff**

Report: what changed; architecture/compatibility impact (none beyond additive
optional field); specs/ADRs (ADR 0259-adjacent slug file + D434); validation
commands and their results; E2E results per suite; commits; merge status; the
remaining risk that `origin` is stale and nothing was pushed. A release bump
(v0.14.25) happens only on an explicit request and must include the still
unreleased D432 retry-card highlight.

---

## Self-review

**Spec coverage:** every design section maps to a task — §3 UI (Task 3 Steps
3-9), §3.1 states (Task 3 Steps 4/6 + Task 4 checks), §3.2 copy (Task 3 Step
10), §4 behavior (Task 3 Steps 6-8), §5.1 data (Task 2), §5.2 renderer (Task
3), §6 compatibility (optional field + legacy check in Task 4 Step 3), §7
testing (Tasks 2, 3, 4), §8 docs (Task 5), §9 out of scope (nothing touches
`/compact`, the palette, or the toasts).

**Placeholder scan:** no TBD/TODO and no "replace this later" steps. The E2E
script in Task 4 is final code, and the fixture's `__PI_INSPECTOR_SESSION__`
global is defined where the script consumes it.

**Type consistency:** `tokensBefore` is optional on `ContextCompactionMark` and
required on `ContextCompactionRecord`; the component reads
`compaction?.tokensBefore`; the fixture's `mark` union drives the same field
name; `compactBlocked` is the prop name in the component, the toolbar, and the
source-contract test.
