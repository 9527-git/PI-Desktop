import { Fragment, type ReactNode } from "react";

/**
 * Lightweight inline markdown renderer for one-line row summaries: code
 * spans and bold render through the same visual language as the chat prose,
 * without block parsing or the full Markdown pipeline. Block level syntax
 * (lists, headings) stays literal text; single-asterisk emphasis is
 * deliberately not parsed so glob patterns in tool arguments survive.
 */
export function MarkdownInline({ source }: { source: string }) {
  return <Fragment>{inlineNodes(source, 0)}</Fragment>;
}

const CODE_SPAN = /`([^`\n]+)`/;
const BOLD = /\*\*([^*\n]+)\*\*/;

type Match = { kind: "code" | "bold"; index: number; inner: string; raw: string };

function firstMatch(text: string): Match | null {
  const code = CODE_SPAN.exec(text);
  const bold = BOLD.exec(text);
  const pick = (kind: Match["kind"], m: RegExpExecArray | null): Match | null =>
    m ? { kind, index: m.index, inner: m[1], raw: m[0] } : null;
  const codeMatch = pick("code", code);
  const boldMatch = pick("bold", bold);
  if (!codeMatch) return boldMatch;
  if (!boldMatch) return codeMatch;
  return codeMatch.index <= boldMatch.index ? codeMatch : boldMatch;
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
      ) : (
        <strong key={key}>
          {inlineNodes(match.inner, base + match.index + match.raw.length)}
        </strong>
      ),
    );
    rest = rest.slice(match.index + match.raw.length);
  }
  return nodes;
}
