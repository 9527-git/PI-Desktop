/**
 * Detection and resolution of file/URL references in chat content so the
 * transcript can preview them: HTML in the work-panel browser, other files
 * with the OS default handler, URLs in the embedded browser.
 *
 * File detection is deliberately conservative: a bare token only counts as a
 * file when it carries a known extension, so ordinary dotted identifiers in
 * prose (`store.messages`) stay plain text. Explicit `@path` tokens from the
 * composer (D124 / D320) are accepted even when quoted or absolute, and so are
 * absolute local paths (Windows drive letters, MSYS mounts on a Windows host).
 *
 * Those absolute local paths resolve *outside* the workspace on purpose — the
 * transcript has to be able to name real artifacts such as a release binary.
 * That is a deliberate reversal of the older "links cannot escape the
 * workspace" rule (D322) **for resolution only**: opening stays gated, because
 * Electron main (`resolveOpenablePath`) still refuses anything outside the
 * workspace root or an allowed extra root, so a refused target fails loudly
 * instead of rendering a chip that could never open.
 *
 * Relative paths are workspace-rooted unless they start with `./` or `../`,
 * in which case they resolve against an optional markdown-file directory and
 * still cannot escape the workspace; `~` paths are recognized but never
 * resolved. Non-ASCII filenames (CJK above all) link exactly like ASCII ones
 * (#235).
 *
 * Split by responsibility: `path-shape` (string shape), `local-path` (drive /
 * MSYS canonicalization), `parse` (token parsing), `resolve` (workspace and
 * absolute resolution), `scan` (prose scanning), `mdast` (markdown linkify).
 */

export {
  isHtmlFilePath,
  isHttpUrl,
  parseFileRef,
  safeDecodeUri,
  unwrapAtFileRef,
} from "./parse";
export {
  getToolPreviewTarget,
  resolveLocalFileRef,
  resolvePreviewTarget,
  toWorkspaceRel,
  type ChatPreviewTarget,
} from "./resolve";
export { absoluteLocalPath, pathIsUnderLocal } from "./local-path";
export { chipLabelFor, splitChatText, type ChatTextSegment } from "./scan";
export {
  fileDirOf,
  isAbsoluteLocalPath,
  isDrivePath,
  isLikelyFilePath,
  isWindowsHost,
  leafName,
  normalizePathSegments,
  stripLineRef,
  toPosix,
} from "./path-shape";
export {
  linkifyMdastTree,
  remarkChatFileLinks,
  type MdastNode,
} from "./mdast";
