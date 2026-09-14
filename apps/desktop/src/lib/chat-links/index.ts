/**
 * Detection and resolution of file/URL references in chat content so the
 * transcript can preview them: HTML in the work-panel browser, other files
 * with the OS default handler, URLs in the embedded browser.
 *
 * File detection is deliberately conservative: a bare token only counts as a
 * file when it carries a known extension, so ordinary dotted identifiers in
 * prose (`store.messages`) stay plain text. Explicit `@path` tokens from the
 * composer (D124 / D320) are accepted even when quoted or absolute, and so are
 * absolute local paths (drive letters, MSYS mounts on Windows), which resolve
 * outside the workspace and open through the host's local-path gate.
 *
 * Relative paths are workspace-rooted unless they start with `./` or `../`, in
 * which case they resolve against an optional markdown-file directory and
 * still cannot escape the workspace (D322).
 *
 * Split by responsibility: `path-shape` (string shape), `parse` (token
 * parsing), `resolve` (workspace/absolute resolution), `scan` (prose
 * scanning), `mdast` (markdown linkify).
 */

export {
  isHtmlFilePath,
  isHttpUrl,
  parseFileRef,
  safeDecodeUri,
  unwrapAtFileRef,
} from "./parse";
export {
  absoluteLocalPath,
  getToolPreviewTarget,
  pathIsUnderLocal,
  resolveLocalFileRef,
  toWorkspaceRel,
  resolvePreviewTarget,
  type ChatPreviewTarget,
} from "./resolve";
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
