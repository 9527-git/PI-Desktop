import { Fragment, type ReactNode } from "react";

/**
 * Lightweight inline markdown renderer for one-line row summaries: code
 * spans, bold, file paths and URLs render through the same visual language
 * as the chat prose, without block parsing or the full Markdown pipeline.
 * Block level syntax (lists, headings) stays literal text; single-asterisk
 * emphasis is deliberately not parsed so glob patterns in tool arguments
 * survive.
 */
export function MarkdownInline({ source }: { source: string }) {
  return <Fragment>{inlineNodes(source, 0)}</Fragment>;
}

const CODE_SPAN = /`([^`\n]+)`/;
const BOLD = /\*\*([^*\n]+)\*\*/;
const URL_TOKEN = /https?:\/\/[^\s`]+/;
const PATH_TOKEN = /(?:[A-Za-z]:)?(?:[\w@+~.-]+[\/\\])+[\w@+~.-]+/;

type MatchKind = "code" | "bold" | "url" | "path";
type Match = { kind: MatchKind; index: number; inner: string; raw: string };

const pick = (kind: MatchKind, re: RegExp, text: string): Match | null => {
  const m = re.exec(text);
  return m ? { kind, index: m.index, inner: m[0], raw: m[0] } : null;
};

function firstMatch(text: string): Match | null {
  const candidates = [
    pick("code", CODE_SPAN, text),
    pick("bold", BOLD, text),
    pick("url", URL_TOKEN, text),
    pick("path", PATH_TOKEN, text),
  ].filter((m): m is Match => m !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.index < a.index ? b : a));
}

function inlineNodes(text: string, base: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  while (rest.length > 0) {
    const match = firstMatch(rest);
    if (!match) {
      nodes.push(rest);
      break;
    }
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    const key = `${base}:${match.index}`;
    nodes.push(
      match.kind === "code" ? (
        <code key={key}>{match.inner}</code>
      ) : match.kind === "bold" ? (
        <strong key={key}>
          {inlineNodes(match.inner, base + match.index + match.raw.length)}
        </strong>
      ) : match.kind === "path" ? (
        <span key={key} className="md-inline-path">
          {match.inner}
        </span>
      ) : (
        // A URL stays literal text: consumed whole so the path scan never
        // recolors its host tail.
        match.inner
      ),
    );
    rest = rest.slice(match.index + match.raw.length);
  }
  return nodes;
}
