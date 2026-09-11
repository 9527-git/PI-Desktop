/**
 * One model the service offers, as a checkbox row.
 *
 * The row is a checkbox label, so clicking it picks or drops the model. The id
 * and name are the exception: that text is copyable, and it is the way into an
 * already-configured model's settings, so a click there never changes what is
 * picked. The checkbox, the row's padding and the limits cell still toggle.
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
          // Keyboard activation reports detail 0 and is not a click that
          // carries a text selection, so it must keep toggling.
          if (event.detail === 0) return;
          // A copied selection can remain active when the user clicks the
          // checkbox next. The checkbox is an explicit toggle target, so
          // an old selection must not cancel its native activation.
          if (event.target instanceof HTMLInputElement) return;
          // A drag-selection inside this row is a copy gesture, not a toggle.
          const selection = window.getSelection();
          const label = event.currentTarget;
          if (
            selection &&
            !selection.isCollapsed &&
            label.contains(selection.anchorNode) &&
            label.contains(selection.focusNode)
          ) {
            event.preventDefault();
          }
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
        <span
          className="provider-models-row-copy selectable"
          onClick={(event) => {
            // Cancelling the click keeps the surrounding label from activating
            // the checkbox: the id and name copy in place, and a plain click
            // opens the model's settings instead of dropping the model.
            event.preventDefault();
            // A drag-copy that happens to end inside the text stays a copy.
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed) return;
            onReveal();
          }}
        >
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
