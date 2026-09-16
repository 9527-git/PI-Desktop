/**
 * Compatibility facade for the split `chat-links/` modules.
 *
 * `chat-links.ts` and `chat-links/` coexist on purpose: module resolution
 * prefers the file, so every existing `from "../lib/chat-links"` import keeps
 * working unchanged while the implementation lives split by responsibility in
 * `./chat-links/*`. New code may import either form.
 */

export * from "./chat-links/index";
