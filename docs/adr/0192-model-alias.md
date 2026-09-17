# ADR 0192: Alias a configured model and make model ids copyable

- Status: Accepted
- Date: 2026-09-08
- Deciders: PI-Desktop renderer and UX maintainers
- Amends: D266
- Related: E2E-201

## Context

Settings → Model configuration lists models by their wire id, while the
composer shows the catalog's published `displayName`. Two gaps surfaced in
daily use:

1. One provider row can carry several models with near-identical published
   names, and a user cannot attach a short personal label ("fast", "pro") to
   one of them. The published display name is catalog-owned and read-only.
2. Model ids in the configuration page could not be copied. The shell disables
   text selection globally, and the id sits inside the row's `<label>`, so a
   drag-select toggled the model checkbox instead of selecting text.

## Decision

1. `ModelBinding` gains an optional `alias?: string`, persisted with the
   provider's `models` array. It is a display label only: `id` remains the wire
   identity sent to the provider.
2. The alias is edited in the selected model's Advanced body and shown as a chip
   beside the id in the selected-model row.
3. Where the composer names a model, a non-empty trimmed alias replaces the
   published display name. An absent or blank alias leaves the published name
   unchanged, so clearing the field restores catalog naming.
4. Model ids and names in the configuration page opt back into text selection
   (`.selectable`). A drag-selection in the clicked row is copy-only.
   *(Supersedes the D426 amendment: individual left-list activation — including
   the checkbox, keyboard and synthetic clicks — adds an absent model or opens
   its existing settings; it never removes a binding. Repeated selection
   preserves aliases, overrides and ordering. Single-model removal is an
   explicit chosen-pane action. The separately labelled bulk select/clear
   operation remains available.)*
5. Host-core persists and normalizes the alias inside the existing provider
   `config_json` `models` array: a blank or absent alias is dropped, and an
   alias longer than 60 characters is rejected with `MODEL_ALIAS_TOO_LONG`. No
   protocol, host RPC, or SQLite schema change; the storage schema stays v13.

## Consequences

- One provider can host several models under short personal labels without
  renaming anything the catalog owns.
- The composer, its search, and the model picker show the alias, while the
  configuration page and the transcript badge keep the real id, so a mistyped
  alias cannot hide which model will be called.
- Copying a model id no longer requires retyping it by hand.

## Rejected alternatives

- **Rename `displayName` on the binding:** duplicates catalog data and loses the
  published name once the alias is cleared.
- **A separate alias registry keyed by model id:** an alias belongs to one
  provider row's configuration; a global map would collide across providers
  that serve the same id.
- **Use individual checkbox deselection as removal:** confuses selecting an
  existing model for editing with deleting its configuration. Keep individual
  activation additive and reserve removal for the dedicated action instead.
