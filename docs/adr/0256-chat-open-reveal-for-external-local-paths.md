# ADR 0256: Chat open/reveal for local paths outside the workspace

- Status: Accepted
- Date: 2026-09-15
- Deciders: PI-Desktop maintainers
- Related: [ADR 0109](0109-open-files-with-the-os-associated-application.md) ·
  [ADR 0111](0111-reveal-files-in-file-manager.md) ·
  [ADR 0163](0163-transcript-file-reference-chips.md) ·
  [ADR 0168](0168-main-owned-open-external-allowlist.md) · D320 · D322 · D424 ·
  supersedes the workspace-only clause of D322 for the two OS handoff actions

## Context

The transcript renders chat-mentioned file paths as clickable references
(D320, ADR 0163), and D322 keeps an unprefixed relative path workspace-rooted
while a walk that leaves the workspace stays plain text. Windows drive paths
(`E:\...\report.xlsx`) — the common shape of build artifacts and of
agent-reported outputs — were not recognized at all, and the `fs/open` /
`fs/reveal` handlers refused every absolute path outside the workspace and the
session data roots, so an artifact path in an assistant answer could not be
opened or located in the file manager.

## Decision

1. The renderer recognizes Windows drive paths, backslash separators, and
   MSYS mounts (on a Windows host) as file references. An absolute drive path
   outside the workspace resolves to an `external` target and opens through
   the OS instead of the work-panel viewer. The path scanner stays linear and
   keeps the Unicode-aware token classes that the same module already uses for
   non-ASCII file names.
2. `fs/open` and `fs/reveal` gain a fallback resolver,
   `resolveLooseOpenablePath`: only an absolute local path qualifies; the
   target must exist and resolve through `realpath`; paths inside protected
   roots (the app data directory) are refused. Workspace and session-root
   containment keeps priority and its behavior is unchanged.
3. `fs/reveal` selects a file in its folder, opens a directory, and falls back
   to the nearest existing ancestor when the entry disappeared between the
   containment check and the handoff, so the action is never a silent no-op.
4. `fs/read`, `fs/list`, `fs/index`, and every agent-tool path gate keep their
   existing workspace-scoped containment. No agent or plugin capability can
   read or write outside its existing scope through this ADR; the relaxation
   applies exclusively to the two user-initiated OS handoff actions.
5. A failed open/reveal surfaces the OS error as a toast, as before.

## Consequences

- A user can open or locate any existing local file the conversation
  mentions, matching the mental model of double-clicking it in a file
  manager.
- A malicious or mistaken message can only induce an OS handoff for a path
  the user explicitly clicks; it cannot read, list, or mutate anything the
  existing gates protect.
- Protected app data stays unreachable even through planted symlinks, because
  the refusal runs on the resolved target.
- The transcript renders chips for absolute paths outside the workspace that
  the previous behavior left as plain text, which is a visible change to what
  the reader can click.

## Alternatives considered

### Keep fs/open and fs/reveal workspace-scoped

Rejected: artifact paths routinely live outside the workspace (release
folders, downloads), and refusing them makes the transcript references dead
ends. D322's plain-text rule exists to stop a *chip that could never open*,
which is exactly what the fallback resolver removes.

### Extend the relaxation to fs/read

Rejected: reading arbitrary local files into the renderer is a genuine
disclosure channel, unlike a user-initiated open/reveal. The boundary between
"show in-app" and "hand off to the OS" is the load-bearing one.

### Route through a confirmation dialog for outside paths

Rejected for now: the action is equivalent to the user opening the file
themselves, and the path is shown in full on the chip before the click. The
protected-roots refusal covers the app's own sensitive data.
