# ADR 0267: Paint the aggregate session status as a native taskbar/Dock badge

- Status: Accepted
- Date: 2026-10-19
- Related: D473

## Context

PI-Desktop runs several sessions at once, and they keep working while the
window is minimized or behind another app. The sidebar already names each
session's state (D444/D451/D455), but that surface is invisible when the app is
not in front. Users asked for the same signal on the OS surface they already
watch: the taskbar button (Windows) and the Dock tile (macOS).

The renderer owns the live state: `runningSessions`, the pending
permission/ask/plan queues, and unread terminal outcomes. Electron Main owns the
native surface: `BrowserWindow.setOverlayIcon` on Windows, `app.dock.setBadge`
on macOS. Neither side alone can answer "what should the badge say right now".

## Decision

1. **One aggregate snapshot, computed by a shared pure function.**
   `resolveTaskbarStatus` in `packages/shared/src/taskbar-status.ts` reduces the
   five renderer maps to `{ kind, count }`. Priority is
   `attention > running > failed > completed > none`. A session contributes to
   exactly one bucket, so a session that is both running and blocked counts
   once under `attention`. The count is bounded to 999 by the wire validator.
2. **The renderer pushes on transitions.** `useTaskbarStatus` subscribes to the
   app store and sends `window/setTaskbarStatus` only when the snapshot's
   signature changes. Main never polls the renderer.
3. **Main paints per platform.**
   - Windows: `setOverlayIcon` with a locally rasterized 16px/32px BGRA badge
     (a status-coloured disc with a white ring and a per-state glyph). The
     bitmap is generated in code from the dark-theme status tokens, so no
     packaged asset can drift and no new resource file is needed.
   - macOS: the Dock badge is text-only, so each state maps to one glyph
     (`…`, `!`, `✕`, `✓`); the full state phrase is not representable there.
   - Linux: no portable taskbar badge exists; the call reports
     `unsupported` and the renderer ignores it.
4. **The description is localized in Main.** The overlay icon's accessibility
   description comes from the `taskbar.*` catalog entries through the same
   resolved locale the tray menu uses.
5. **Malformed snapshots fail closed.** `window/setTaskbarStatus` rejects a
   value that is not a well-formed snapshot with `INVALID_ARGUMENT` instead of
   clearing or inventing a badge. This is an additive Electron-local channel:
   no Host RPC, storage schema, permission, or `PROTOCOL_VERSION` change.

## Consequences

- The taskbar/Dock now answers "is PI-Desktop working, waiting on me, or done"
  without the window being visible, using the same priority the sidebar uses.
- Windows gets a real pictogram; macOS gets the platform's own glyph badge;
  Linux degrades to nothing rather than pretending.
- The shared reducer is unit-tested for priority and single-count semantics;
  the Main painter is unit-tested for its platform branches and the BGRA
  bitmap; the wiring is pinned by a source contract; a CDP E2E drives the real
  app through every state and the invalid-payload path.
- Renderer, Main, shared, i18n, docs, and tests only: no schema, permission,
  or protocol-version change.

## Alternatives

### Let the renderer draw into the window icon

Rejected. The taskbar button is composited by the OS from the window icon;
per-state icons would replace the brand mark and cannot overlay a small corner
badge, and macOS has no equivalent.

### Count everything in one number

Rejected. A bare count cannot distinguish "three agents are working" from
"three agents are blocked on you"; the latter is the state that needs action.

### Poll the store from Main

Rejected. Main has no renderer store, and polling across the IPC boundary
would add latency and traffic for a signal that already changes discretely.
