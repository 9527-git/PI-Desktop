import { Fragment, type ReactNode } from "react";
import {
  inlineMarkdownNodes,
  type InlineMarkdownNode,
} from "../lib/markdown-inline";

/**
 * Lightweight inline markdown renderer for one-line row summaries: code
 * spans, bold, file paths and URLs render through the same visual language
 * as the chat prose, without block parsing or the full Markdown pipeline.
 * Block level syntax (lists, headings) stays literal text; single-asterisk
 * emphasis is deliberately not parsed so glob patterns in tool arguments
 * survive.
 */
export function MarkdownInline({ source }: { source: string }) {
  return <Fragment>{renderNodes(inlineMarkdownNodes(source))}</Fragment>;
}

function renderNodes(nodes: readonly InlineMarkdownNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    const key = String(index);
    switch (node.kind) {
      case "code":
        return <code key={key}>{node.text}</code>;
      case "bold":
        return <strong key={key}>{renderNodes(node.children)}</strong>;
      case "path":
        return (
          <span key={key} className="md-inline-path">
            {node.text}
          </span>
        );
      default:
        return node.text;
    }
  });
}
