/**
 * One model the service offers, as a checkbox row.
 *
 * The checkbox is the only control that picks or drops the model. Every other
 * part of the row is an open gesture: a click on a configured row reveals its
 * settings in the right pane, and a click on an unconfigured one picks it. The
 * id and name stay copyable, so a drag-selection is a copy, not an activation.
 */
import { formatTokenCount } from "@pi-desktop/shared";
import type { ModelRow } from "./ModelSelectionPanes";

export type ProviderModelRowProps = {
  row: ModelRow;
  /** Already configured, so the right pane can be pointed at its settings. */
  chosen: boolean;
  /** The caller is saving, so the checkbox stops accepting input. */
  busy: boolean;
  onToggle: () => void;
  /** Reveal this model's configuration in the right pane. */
  onReveal: () => void;
};

export function ProviderModelRow({
  row,
  chosen,
  busy,
  onToggle,
  onReveal,
}: ProviderModelRowProps) {
  return (
    <li className="provider-models-row">
      <label
        className="provider-models-row-label"
        onClick={(event) => {
          // Keyboard activation reports detail 0 and is not a pointer click,
          // so it keeps the checkbox's native toggle.
          if (event.detail === 0) return;
          // The checkbox is an explicit toggle target; its native activation
          // must run even when a copied selection is still active.
          if (event.target instanceof HTMLInputElement) return;
          // A drag-selection inside this row is a copy gesture, not an
          // activation of the row.
          const selection = window.getSelection();
          const label = event.currentTarget;
          if (
            selection &&
            !selection.isCollapsed &&
            label.contains(selection.anchorNode) &&
            label.contains(selection.focusNode)
          ) {
            event.preventDefault();
            return;
          }
          // Cancelling the click keeps the label from activating the checkbox,
          // so a click outside the checkbox never drops the model: the row's
          // pointer cursor always opens or picks, never removes. A configured
          // row opens its settings; an unconfigured one is picked.
          event.preventDefault();
          if (busy) return;
          if (chosen) onReveal();
          else onToggle();
        }}
      >
        <input
          type="checkbox"
          className="provider-models-check"
          checked={chosen}
          disabled={busy}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onChange={onToggle}
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
