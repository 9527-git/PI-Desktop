/**
 * Project pi session entries into the model context.
 *
 * pi 1.1 folded the agent harness into `@earendil-works/pi-coding-agent` and
 * stopped exporting the entry model the sync projection was built on. The
 * 0.87-shaped engine PI-Desktop pins — entry types, cut points, estimates and
 * the shared message filter — now lives in `session-entries.ts`; this module
 * keeps the `{ messages }` shape the runtime already consumes on top of it.
 */

import {
  buildContextEntries,
  sessionEntryToContextMessages,
  type AgentMessage,
  type Entry,
} from "./session-entries.js";

export function buildSessionContext(pathEntries: readonly Entry[]): {
  messages: AgentMessage[];
} {
  return {
    messages: buildContextEntries(pathEntries).flatMap(
      sessionEntryToContextMessages,
    ),
  };
}
