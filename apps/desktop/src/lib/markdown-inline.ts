/**
 * Pure inline-markdown tokenizer for one-line row summaries.
 *
 * The chat prose runs the full markdown pipeline; collapsed tool, thinking,
 * and subagent rows only need code spans, bold, file paths and URLs, and they
 * re-render per stream tick, so they tokenize here instead. The JSX mapping
 * lives in `components/MarkdownInline.tsx`.
 */

export type InlineMarkdownNode =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "path"; text: string }
  | { kind: "bold"; children: InlineMarkdownNode[] };

const CODE_SPAN = /`([^`\n]+)`/;
const BOLD = /\*\*([^*\n]+)\*\*/;
const URL_TOKEN = /https?:\/\/[^\s`]+/;
const PATH_TOKEN = /(?:[A-Za-z]:)?(?:[\w@+~.-]+[\/\\])+[\w@+~.-]+/;

type MatchKind = "code" | "bold" | "url" | "path";
type Match = { kind: MatchKind; index: number; inner: string; raw: string };

const pick = (kind: MatchKind, re: RegExp, text: string): Match | null => {
  const m = re.exec(text);
  if (!m) return null;
  // The capture group is the payload, never the whole match: `bold`
  // re-tokenizes its payload, and a payload still carrying the `**`
  // delimiters would re-match itself and recurse until the stack overflows
  // (session open crashed on any `**bold**` row summary). URL and path
  // patterns carry no group and take the whole match.
  return { kind, index: m.index, inner: m[1] ?? m[0], raw: m[0] };
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

function nodeFor(match: Match): InlineMarkdownNode {
  switch (match.kind) {
    case "code":
      return { kind: "code", text: match.inner };
    case "bold":
      // A bold payload excludes `*`, so this recursion is one level deep.
      return { kind: "bold", children: inlineMarkdownNodes(match.inner) };
    case "path":
      return { kind: "path", text: match.inner };
    default:
      // A URL stays literal text: consumed whole so the path scan never
      // recolors its host tail.
      return { kind: "text", text: match.inner };
  }
}

/**
 * Tokenize `text` into literal runs and styled spans. Block level syntax
 * (lists, headings) stays literal text; single-asterisk emphasis is
 * deliberately not parsed so glob patterns in tool arguments survive.
 */
export function inlineMarkdownNodes(text: string): InlineMarkdownNode[] {
  const nodes: InlineMarkdownNode[] = [];
  let rest = text;
  while (rest.length > 0) {
    const match = firstMatch(rest);
    if (!match) {
      nodes.push({ kind: "text", text: rest });
      break;
    }
    if (match.index > 0) {
      nodes.push({ kind: "text", text: rest.slice(0, match.index) });
    }
    nodes.push(nodeFor(match));
    rest = rest.slice(match.index + match.raw.length);
  }
  return nodes;
}
