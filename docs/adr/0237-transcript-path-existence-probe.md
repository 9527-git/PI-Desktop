# ADR 0237: Existence probe for transcript path rows

- Status: Accepted
- Date: 2026-09-14
- Deciders: PI-Desktop maintainers
- Related: [ADR 0109](0109-open-files-with-the-os-associated-application.md) ·
  [ADR 0111](0111-reveal-files-in-file-manager.md) ·
  [ADR 0236](0236-chat-open-reveal-for-external-local-paths.md) · D409

## Context

The per-turn summary lists the files a turn changed and the outputs its answer
reported, and each row can open or reveal that path. A path can go stale the
moment it is written: a build artifact is deleted, a file is renamed, a
temporary output is cleaned up. The row then offers actions that cannot
succeed, and the user cannot tell a broken reference from a slow one.

The renderer has no filesystem access by design, so it cannot answer this
question itself, and probing by reading the file would pull content into the
renderer for a question about metadata.

## Decision

1. Add the additive IPC channel `pi-desktop/fs/stat` (renderer wrapper
   `api.fsStat`).
2. The handler reports `{ exists, kind }` only, where `kind` is `file`, `dir`,
   or `null`. No content, size, or directory listing crosses the boundary.
3. Resolution reuses the existing gates: the workspace-scoped resolver first,
   then the ADR 0236 OS-handoff resolver, with the app data directory refused.
   A path outside the allowed roots reports `exists: false`, which is the
   honest answer for a row that could not open or reveal it either.
4. The transcript marks a row whose verdict is `false` and disables its
   actions. A failed or unavailable probe reports `false`: the renderer has no
   evidence that the file exists.
5. No host-core, storage schema, or plugin SDK change.

## Consequences

- A referenced path that no longer resolves reads as stale instead of as a
  dead button.
- The probe adds a bounded metadata oracle over absolute paths the user is
  already shown. It discloses existence and entry kind, not content, and only
  for paths the transcript renders.
- The card issues one probe per unique path per render, capped, with late
  answers dropped when the path set changes.

## Alternatives considered

### Probe by reading with `fs/read`

Rejected: it returns file bytes for a metadata question, and the renderer
would hold content it does not display.

### Do nothing and let open/reveal fail

Rejected: the error arrives only after the click, and a reveal on a missing
entry is a silent no-op on Windows — the exact dead-button report this
replaces.

### Cache verdicts in the session store

Rejected for now: the answer changes whenever the user's disk does, and a
cached verdict would need invalidation on every filesystem event. The card
probes on render, which is when the answer is shown.
