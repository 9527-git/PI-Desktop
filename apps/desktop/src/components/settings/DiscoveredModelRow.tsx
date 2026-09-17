/**
 * One discovered model as an additive activation row.
 *
 * Activating a row is never a removal: the text, the name, the limits, the row
 * padding, the checkbox, and a keyboard or synthetic activation all resolve to
 * the same `onSelect`, which the pane implements as "add if absent, otherwise
 * open what is already configured". The row is extracted from the pane so the
 * copy-only drag guard and the label's native-forwarding cancel have one
 * executable home the contract tests can read.
 */
import { formatTokenCount } from "@pi-desktop/shared";
import type { ModelRow } from "./ModelSelectionPanes";

export type DiscoveredModelRowProps = {
  row: ModelRow;
  /** True when this row's id is already among the chosen bindings. */
  chosen: boolean;
  /** True while the caller saves; every activation path stops. */
  busy: boolean;
  /** Add the model if absent, otherwise open its existing configuration. */
  onSelect: () => void;
};

export function DiscoveredModelRow({
  row,
  chosen,
  busy,
  onSelect,
}: DiscoveredModelRowProps) {
  return (
    <li className="provider-models-row">
      <label
        className="provider-models-row-label"
        onClick={(event) => {
          // The checkbox owns its own activation; its change handler routes to
          // the same additive select, so a click on it must not double-fire here.
          if (event.target instanceof HTMLInputElement) return;
          // Every other activation - text, name, limits, padding, keyboard and
          // the synthetic detail-0 click - would otherwise be forwarded by the
          // label into a destructive checkbox toggle. Cancel that native
          // forwarding and add/open instead.
          event.preventDefault();
          if (busy) return;
          // A drag-selection inside this row is a copy gesture, not a select.
          const selection = window.getSelection();
          const label = event.currentTarget;
          if (
            selection &&
            !selection.isCollapsed &&
            label.contains(selection.anchorNode) &&
            label.contains(selection.focusNode)
          ) {
            return;
          }
          onSelect();
        }}
      >
        <input
          type="checkbox"
          className="provider-models-check"
          checked={chosen}
          disabled={busy}
          aria-label={row.id}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onChange={onSelect}
        />
        <span className="provider-models-row-copy selectable">
          <span className="provider-models-row-id font-mono">{row.id}</span>
          {row.displayName && row.displayName !== row.id ? (
            <span className="provider-models-row-name">{row.displayName}</span>
          ) : null}
        </span>
        <span className="provider-models-row-limits">
          {formatTokenCount(row.contextWindow)} · {formatTokenCount(row.maxTokens)}
        </span>
      </label>
    </li>
  );
}
