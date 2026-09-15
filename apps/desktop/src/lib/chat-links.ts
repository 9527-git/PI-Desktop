/**
 * Detection and resolution of file/URL references in chat content so the
 * transcript can preview them: HTML in the work-panel browser, other files
 * with the OS default handler, URLs in the embedded browser.
 *
 * This file stays as the module's public entry point so every existing
 * `../lib/chat-links` import keeps working unchanged. The implementation is
 * split by responsibility under `./chat-links/`; see that directory's
 * `index.ts` for the shape of the whole module.
 */
export * from "./chat-links/index";
