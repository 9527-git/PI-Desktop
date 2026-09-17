# Context Inspector Compact Action — Design

- Status: Approved for implementation
- Date: 2026-09-17
- Branch: `feat/context-inspector-compact-action`
- Base: local `main` @ `b9f621ed` (v0.14.24)
- Amends (planned): ADR 0103 (compact context usage summary), ADR 0106 (core
  five builtin commands — the "slash-first" wording)
- Related specs: `04-ux/08-component-spec.md`, `04-ux/09-interaction-patterns.md`,
  `03-runtime/01-ipc-protocol.md` §5.6

## 1. Problem

Context compaction can only be started from `/compact` (`builtin.agent.compact`)
or the command palette. The context usage inspector — the surface that shows how
full the model context is — is read-only, so the moment a user sees the context
filling up is also the moment they must remember a slash command.

Goal: the inspector popover card can start a manual compaction for the active
session and reflect the result in place.

## 2. Decisions taken during brainstorming

| # | Decision | Rationale |
|---|---|---|
| 1 | The card is both the entry point **and** the result surface (trigger + status). | One place for "how full is it" and "make room". |
| 2 | The trigger is a bottom action row inside the popover (full-width separated row): muted hint on the left, button on the right. | Largest hit target, best discoverability, room to extend later. Rejected: inline button in the checkpoint line (small target), header icon button (weak affordance). |
| 3 | Depth: renderer-first. The checkpoint line keeps its current content and gains one persisted "before this compaction" figure. No runtime compaction-semantics change. | Smallest safe diff; the persistent figure comes from a field the checkpoint record already stores. |
| 4 | No confirmation step. | Compaction is non-destructive: the transcript keeps every message, compaction only installs a checkpoint. Consistent with `/compact`. |
| 5 | Reuse the existing store action `compactContext()` and the existing `agent.compact` IPC. | Zero new channels, zero new permissions, all guards/error handling already exist. |

## 3. UI design

The popover keeps its current sections (leading figure, window row, turn/speed
KPIs, provider row, tools row, checkpoint line) and adds one action row at the
bottom, separated by space and a hairline rule.

```
┌ Context inspector popover ─────────────────────────┐
│ 剩余 84k                                     66%   │
│ 上下文窗口            44.2k / 128k  35%             │
│ 本轮总计   44.2k                                    │
│ 生成速度   82 tok/s                                 │
│ 提供方用量   输入 12k 输出 3.2k 缓存读 30k          │
│ 工具        3 类 · 12 次 · ~8.4k                    │
│ 已压缩 3 次 · 摘要                          ~4.2k   │
│ 本次压缩前占用                              ~92k    │
│ ───────────────────────────────────────────────    │
│ 压缩会生成检查点摘要，保留最近消息         [压缩上下文] │
└────────────────────────────────────────────────────┘
```

### 3.1 States

| State | Condition | Presentation |
|---|---|---|
| Idle | Session has no compaction activity and is not blocked | Button enabled, label `chat.usageCompactAction`; hint `chat.usageCompactHint` |
| Busy | `agentStatuses[activeSessionId].activity?.phase === "compacting"` | Button disabled with spinner + `chat.usageCompactBusy`; hint switches to `chat.usageCompactBusyHint` |
| Blocked | `compactBlocked` prop is true (see §4) | Button disabled, hint unchanged |
| Done | Newest checkpoint changes (`sessionCompactions`) | Checkpoint line updates in place; the dim "before" line appears when the newest mark carries `tokensBefore` |
| Failed | `compactContext` rejects / `compaction_end.ok === false` | Card unchanged; the existing error toast (`contextCompaction.failed`) reports it |

The checkpoint "before" line shows only when the newest `ContextCompactionMark`
for the active session has `tokensBefore`. Historical checkpoints written before
this change do not, so they degrade to today's single line.

### 3.2 Copy (new i18n keys)

Namespace `chat` (existing inspector keys live there). English and Simplified
Chinese below; the other six locales (zh-TW, tr, ko, fr, es, de) are translated
during implementation.

| Key | en | zh-CN |
|---|---|---|
| `chat.usageCompactAction` | `Compact context` | `压缩上下文` |
| `chat.usageCompactBusy` | `Compacting…` | `压缩中…` |
| `chat.usageCompactHint` | `Compaction creates a checkpoint summary and keeps recent messages` | `压缩会生成检查点摘要，保留最近消息` |
| `chat.usageCompactBusyHint` | `Generating checkpoint summary…` | `正在生成检查点摘要…` |
| `chat.usageCompactionBefore` | `Before this compaction` | `本次压缩前占用` |

The button uses `TooltipButton` (tooltip and aria-label = `chat.usageCompactAction`;
`TooltipButton` already renders tooltips for disabled buttons). The busy button
carries `aria-busy="true"`.

## 4. Behavior rules

- Clicking the button calls the existing store action `compactContext()`. That
  action already: requires an active session, refuses while the session is
  running, marks the session running, calls `api.compact({ sessionId })`, and
  toasts failures — except `CONTEXT_COMPACTION_FAILED`, whose error toast comes
  from the `compaction_end` event path.
- The popover **stays open** across the action: the busy state, the updated
  checkpoint line, and the "before" line are the in-place feedback. Escape,
  outside-click, and scroll-away behavior are unchanged.
- `compactBlocked` is passed from `ComposerToolbar` as
  `controlsBlocked || runActive`:
  - `controlsBlocked` (approval pending, or a `pi-native` session) — a native
    session cannot run our compaction, and its composer controls are already
    disabled.
  - `runActive` (`isRunning || executionActive`) — compaction is a turn-boundary
    operation and the store action refuses a running session; disabling the
    button keeps the UI honest instead of failing silently.
- Starting a compaction from the card keeps the existing side effects: one
  transcript divider row, one warning toast, the `compaction_end` checkpoint
  mark, and the `activity.phase === "compacting"` status.

## 5. Data and implementation

### 5.1 Persisted "before" figure

`ContextCompactionRecord` already stores `tokensBefore`. The mark is derived
from the record by `contextCompactionMark()` in `packages/shared/src/context-compaction.ts`,
so:

- Add optional `tokensBefore?: number` to `ContextCompactionMark`
  (`packages/shared/src/types/sessions.ts`) and fill it from the record.
- The field rides the existing `compaction_end` event payload and the restored
  `SessionDetail.compactions` path — additive and backward compatible.
- Include the field in `compactionMarksEqual` (`apps/desktop/src/lib/assistant-turns.ts`)
  so memoized transcript rows still re-render when only this value changes.
- No store shape, storage schema, or migration change: the durable record is the
  source, marks stay renderer state.

### 5.2 Renderer changes

- `apps/desktop/src/components/ContextUsageInspector.tsx`: add the action row
  and the busy/idle presentation; new optional prop `compactBlocked`; new store
  selectors for `agentStatuses[activeSessionId]?.activity` and `compactContext`.
  The component is ~414 lines today and stays below the ~500 line guideline.
- `apps/desktop/src/features/chat/composer/ComposerToolbar.tsx`: pass
  `compactBlocked={controlsBlocked || runActive}` next to the existing spread.
- `apps/desktop/src/styles/messages.css`: styles for the action row inside the
  existing `.context-inspector-*` block (hairline separator, hint, button).
- `packages/i18n/src/locales/*/index.ts`: the five keys in §3.2 across all eight
  locales.

No change to `store.compactContext()`, `api.compact`, Electron main, the sidecar,
host-core, or the plugin SDK.

## 6. Compatibility and risks

- **Additive only.** Old checkpoints lack `tokensBefore` → the "before" line is
  hidden. Old clients ignore the new optional field. No migration, no
  deprecation, no behavior change for `/compact`, the palette, or the toasts.
- A manual compaction that finds no cut point fails; the existing
  `CONTEXT_COMPACTION_FAILED` toast reports it and the card stays unchanged.
  This matches `/compact` today.
- Another worktree (`fix/manual-compaction-queue-busy`) is active in the
  compaction area; conflicts, if any, are resolved during integration.

## 7. Testing

- `apps/desktop/test/context-compaction.test.mjs` (source-contract test): pin the
  action row, the `compactBlocked` wiring, the busy label/hint swap, the
  "before" line, and the new locale keys.
- `packages/shared/src/context-compaction.test.ts`: `contextCompactionMark`
  carries `tokensBefore` from the record and omits it when the record has none.
- Manual UI verification on a real build through the CDP harness (no automated
  renderer E2E exists for this surface).
- New E2E scenario `E2E-CHAT-compact-from-context-inspector` in
  `06-delivery/04-e2e-test-plan.md`: idle session with history → open inspector →
  click Compact context → button disabled with the busy label → divider row and
  warning toast → checkpoint line and "before" line update; a running session
  shows the button disabled. Post-integration execution follows AGENTS.md §15.

## 8. Documentation to synchronize

- `docs/spec/04-ux/08-component-spec.md` + `docs/zh-CN/...`: inspector action row
  and states.
- `docs/spec/04-ux/09-interaction-patterns.md` + zh-CN: checkpoint line gains
  the "before" figure; the action row behavior.
- `docs/spec/03-runtime/01-ipc-protocol.md` + zh-CN: `compaction_end.mark` gains
  the optional `tokensBefore`.
- `docs/adr/context-inspector-compact-action.md` (slug file name; numbering is
  collision-prone across agents) amending ADR 0103 and ADR 0106, plus index rows
  in `docs/adr/README.md` and `docs/zh-CN/adr/index.md`.
- `docs/spec/08-meta/decisions-log.md` + zh-CN: one entry for this decision
  (next free D number verified at implementation time).

## 9. Out of scope

- Changing `/compact`, palette dispatch, toasts, or the transcript divider row.
- Compaction history lists, per-checkpoint details, auto-compaction thresholds.
- A confirmation dialog or an undo affordance.
- Any runtime/sidecar change to compaction semantics or retention.
