/**
 * Linkify file/URL references inside markdown phrasing so the existing
 * markdown Anchor handler can preview them. Fenced code, inline code, existing
 * links/images, and html nodes are skipped.
 */

import { splitChatText } from "./scan";

/** Minimal mdast node the markdown rewriter understands. */
export type MdastNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
};

const SKIP_MDAST = new Set([
  "code",
  "inlineCode",
  "link",
  "image",
  "definition",
  "html",
]);

export function linkifyMdastTree(
  tree: MdastNode | null | undefined,
  root?: string | null,
  baseDir?: string | null,
): void {
  walk(tree, false);

  function walk(node: MdastNode | null | undefined, skip: boolean) {
    if (!node || typeof node.type !== "string") return;
    const nextSkip = skip || SKIP_MDAST.has(node.type);
    if (!node.children) return;
    const next: MdastNode[] = [];
    for (const child of node.children) {
      if (!child || typeof child.type !== "string") continue;
      if (!nextSkip && child.type === "text" && typeof child.value === "string") {
        const segments = splitChatText(child.value, root, baseDir);
        if (segments.length === 1 && segments[0].kind === "text") {
          next.push(child);
          continue;
        }
        for (const segment of segments) {
          if (segment.kind === "text") {
            next.push({ type: "text", value: segment.text });
            continue;
          }
          const url =
            segment.target.kind === "url"
              ? segment.target.url
              : segment.target.path;
          next.push({
            type: "link",
            url,
            children: [{ type: "text", value: segment.text }],
          });
        }
        continue;
      }
      walk(child, nextSkip);
      next.push(child);
    }
    node.children = next;
  }
}

/**
 * Unified attacher for the chat file-link pass. `ReactMarkdown` / unified
 * call the plugin with options at freeze time and expect a transformer
 * back; returning the transformer itself makes unified invoke it with
 * `tree === undefined` and crash on `tree.type` when a session paints.
 */
export function remarkChatFileLinks(
  root?: string | null,
  baseDir?: string | null,
) {
  return function remarkChatFileLinksPlugin() {
    return (tree: MdastNode) => {
      linkifyMdastTree(tree, root, baseDir);
    };
  };
}
