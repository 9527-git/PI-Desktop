/**
 * Bridge to pi's prompt-template ("slash command") system for the composer
 * (D123, ADR 0024). `.pi/prompts` assets behave identically in pi CLI and
 * PI-Desktop: loading, name shadowing, and the argument grammar are ported
 * from the pinned 0.87 `pi-agent-core` implementation.
 *
 * pi 1.1 rebuilt template loading synchronously around its CLI config
 * directories and stopped exporting the source-tagged loader that backed the
 * composer, so the loader lives here now. Discovery:
 * `<workspace>/.pi/prompts/*.md` (project) and
 * `~/.pi/agent/prompts/*.md` (user-global); project wins name conflicts.
 */
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Static v1 prompt for Composer's one-shot draft enhancement. */
export const PROMPT_ENHANCEMENT_SYSTEM_PROMPT = `You are a writing assistant that improves message drafts. Rewrite the user's
draft to be clearer, more concise, and better organized while preserving the
original meaning, intent, tone, and language. Do not add facts or requests
that the draft does not imply. Keep the same language as the draft. If the
draft is already good, return it with at most minor polish. Output only the
rewritten draft — no explanations, no preamble, no code fences, no quotation
marks.`;

export const PROMPT_ENHANCEMENT_USER_PREFIX = "Draft:\n";

export type ComposerTemplateSource = "project" | "user";

/** A loaded prompt template — the 0.87 loader's `{name, description, content}`. */
export interface PromptTemplate {
  name: string;
  description: string;
  content: string;
}

export type ComposerTemplate = PromptTemplate & {
  source: ComposerTemplateSource;
  /** Frontmatter `argument-hint`, e.g. "<file> [focus]". */
  argumentHint?: string;
};

export type ComposerTemplateDirs = {
  project?: string;
  user: string;
};

export type PromptTemplateDiagnostic = {
  type: "warning";
  code: string;
  message: string;
  path: string;
};

function isNotFoundError(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

type FrontmatterParse =
  | { ok: true; value: { frontmatter: Record<string, string>; body: string } }
  | { ok: false; error: unknown };

/**
 * Frontmatter subset pi's loader relied on (the `yaml` package reduced to the
 * first plain `key: value` on a line — the composer reads `description` only).
 */
function parseFrontmatter(content: string): FrontmatterParse {
  try {
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!normalized.startsWith("---")) {
      return { ok: true, value: { frontmatter: {}, body: normalized } };
    }
    const endIndex = normalized.indexOf("\n---", 3);
    if (endIndex === -1) {
      return { ok: true, value: { frontmatter: {}, body: normalized } };
    }
    const yamlString = normalized.slice(4, endIndex);
    const body = normalized.slice(endIndex + 4).trim();
    const frontmatter: Record<string, string> = {};
    for (const line of yamlString.split("\n")) {
      const match = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line);
      if (match) frontmatter[match[1]] = match[2].trim();
    }
    return { ok: true, value: { frontmatter, body } };
  } catch (error) {
    return { ok: false, error };
  }
}

async function loadTemplateFromFile(
  filePath: string,
  fileName: string,
): Promise<{ promptTemplate: PromptTemplate | null; diagnostics: PromptTemplateDiagnostic[] }> {
  const diagnostics: PromptTemplateDiagnostic[] = [];
  let rawContent: string;
  try {
    rawContent = await readFile(filePath, "utf8");
  } catch (error) {
    if (!isNotFoundError(error)) {
      diagnostics.push({
        type: "warning",
        code: "read_failed",
        message: error instanceof Error ? error.message : String(error),
        path: filePath,
      });
    }
    return { promptTemplate: null, diagnostics };
  }
  const parsed = parseFrontmatter(rawContent);
  if (!parsed.ok) {
    diagnostics.push({
      type: "warning",
      code: "parse_failed",
      message:
        parsed.error instanceof Error ? parsed.error.message : String(parsed.error),
      path: filePath,
    });
    return { promptTemplate: null, diagnostics };
  }
  const { frontmatter, body } = parsed.value;
  const firstLine = body.split("\n").find((line) => line.trim());
  let description =
    typeof frontmatter.description === "string" ? frontmatter.description : "";
  if (!description && firstLine) {
    description = firstLine.slice(0, 60);
    if (firstLine.length > 60) description += "...";
  }
  return {
    promptTemplate: {
      name: fileName.replace(/\.md$/i, ""),
      description,
      content: body,
    },
    diagnostics,
  };
}

async function loadTemplatesFromDir(
  dir: string,
): Promise<{
  promptTemplates: PromptTemplate[];
  diagnostics: PromptTemplateDiagnostic[];
}> {
  const promptTemplates: PromptTemplate[] = [];
  const diagnostics: PromptTemplateDiagnostic[] = [];
  let entries: string[];
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    entries = dirents
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
  } catch (error) {
    if (!isNotFoundError(error)) {
      diagnostics.push({
        type: "warning",
        code: "list_failed",
        message: error instanceof Error ? error.message : String(error),
        path: dir,
      });
    }
    return { promptTemplates, diagnostics };
  }
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    const result = await loadTemplateFromFile(join(dir, name), name);
    if (result.promptTemplate) promptTemplates.push(result.promptTemplate);
    diagnostics.push(...result.diagnostics);
  }
  return { promptTemplates, diagnostics };
}

function normalizeTemplateName(name: string): string {
  const normalized = name.replace(/\\/g, "/").replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  const basename = slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
  return basename.replace(/\.md$/i, "");
}

/** Template directories for a workspace (project dir absent without one). */
export function composerTemplateDirs(
  workspaceRoot: string | null | undefined,
): ComposerTemplateDirs {
  return {
    ...(workspaceRoot ? { project: join(workspaceRoot, ".pi", "prompts") } : {}),
    user: join(homedir(), ".pi", "agent", "prompts"),
  };
}

/**
 * pi's loader keeps only name/description/content; `argument-hint` needs a
 * second look at the file's frontmatter block. Missing/unreadable files are
 * non-fatal — the hint is cosmetic.
 */
export async function readArgumentHint(
  filePath: string,
): Promise<string | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const hint = parseFrontmatterSectionHint(normalized);
    return hint || undefined;
  } catch {
    return undefined;
  }
}

function parseFrontmatterSectionHint(normalized: string): string | undefined {
  if (!normalized.startsWith("---")) return undefined;
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return undefined;
  const frontmatter = normalized.slice(4, end);
  const match = frontmatter.match(/^argument-hint:[ \t]*(.+)$/m);
  if (!match) return undefined;
  const value = match[1].trim().replace(/^["']|["']$/g, "");
  return value || undefined;
}

/**
 * Load the merged template list for the composer "/" menu. Project templates
 * shadow user-global templates with the same name. Load failures degrade to
 * diagnostics, never throw.
 */
export async function loadComposerTemplates(
  workspaceRoot: string | null | undefined,
  overrideDirs?: ComposerTemplateDirs,
): Promise<{ templates: ComposerTemplate[]; diagnostics: string[] }> {
  const dirs = overrideDirs ?? composerTemplateDirs(workspaceRoot);
  const inputs: Array<{ path: string; source: ComposerTemplateSource }> = [
    ...(dirs.project ? [{ path: dirs.project, source: "project" as const }] : []),
    { path: dirs.user, source: "user" as const },
  ];
  const diagnostics: Array<
    PromptTemplateDiagnostic & { source: ComposerTemplateSource }
  > = [];
  const loaded: Array<{
    promptTemplate: PromptTemplate;
    source: ComposerTemplateSource;
  }> = [];
  for (const input of inputs) {
    const result = await loadTemplatesFromDir(input.path);
    for (const promptTemplate of result.promptTemplates) {
      loaded.push({ promptTemplate, source: input.source });
    }
    for (const diagnostic of result.diagnostics) {
      diagnostics.push({ ...diagnostic, source: input.source });
    }
  }

  const byName = new Map<string, ComposerTemplate>();
  for (const { promptTemplate, source } of loaded) {
    // Inputs are ordered project-first, so the first occurrence wins.
    const name = normalizeTemplateName(promptTemplate.name);
    if (byName.has(name)) continue;
    const dir = source === "project" ? dirs.project : dirs.user;
    const argumentHint = dir
      ? await readArgumentHint(join(dir, `${name}.md`))
      : undefined;
    byName.set(name, {
      ...promptTemplate,
      name,
      source,
      ...(argumentHint ? { argumentHint } : {}),
    });
  }
  return {
    templates: [...byName.values()],
    diagnostics: diagnostics.map(
      (d) => `${d.source}:${d.code}: ${d.message} (${d.path})`,
    ),
  };
}

const PLACEHOLDER_RE = /\$\d+|\$\{@:\d+(?::\d+)?\}|\$ARGUMENTS|\$@/;

export type SlashExpansion = {
  /** Expanded prompt text the model receives (persisted as `content`). */
  expanded: string;
  /** The typed invocation, e.g. "/review src/a.ts" (persisted as `command`). */
  command: string;
};

/**
 * Expand a leading `/name args` invocation against loaded templates using
 * pi's exact argument grammar. Returns null when the draft is not a
 * template invocation (unknown names stay literal text, D123).
 *
 * One deliberate extension over pi: when a template has no placeholder at
 * all, non-empty arguments are appended after a blank line instead of being
 * silently dropped.
 */
export function expandSlashInvocation(
  content: string,
  templates: ReadonlyArray<Pick<ComposerTemplate, "name" | "content">>,
): SlashExpansion | null {
  if (!content.startsWith("/")) return null;
  const tokenEnd = content.search(/[\s]/);
  const token = tokenEnd === -1 ? content : content.slice(0, tokenEnd);
  const name = token.slice(1);
  if (!name) return null;
  const template = templates.find((t) => t.name === name);
  if (!template) return null;

  const rest = (tokenEnd === -1 ? "" : content.slice(tokenEnd)).trim();
  // parseCommandArgs only splits on spaces/tabs; fold newlines in first.
  const args = parseCommandArgs(rest.replace(/[\n\r]+/g, " "));
  let expanded = substituteArgs(template.content, args);
  if (rest && !PLACEHOLDER_RE.test(template.content)) {
    expanded = `${expanded}\n\n${rest}`;
  }
  return { expanded, command: content.trim() };
}

/**
 * Parse an argument string using simple shell-style single and double
 * quotes, as the pinned 0.87 kernel's parser does.
 */
export function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];
    if (inQuote) {
      if (char === inQuote) inQuote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === " " || char === "\t") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

/**
 * Substitute prompt template placeholders (`$1`, `$@`, `$ARGUMENTS`,
 * `${@:N}`, `${@:N:L}`) with command arguments — the 0.87 grammar, kept
 * verbatim so a template expands identically in pi CLI and PI-Desktop.
 */
export function substituteArgs(content: string, args: string[]): string {
  let result = content;
  result = result.replace(/\$(\d+)/g, (_, num) => args[parseInt(num, 10) - 1] ?? "");
  result = result.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_, startStr, lengthStr) => {
    let start = parseInt(startStr, 10) - 1;
    if (start < 0) start = 0;
    if (lengthStr) {
      return args.slice(start, start + parseInt(lengthStr, 10)).join(" ");
    }
    return args.slice(start).join(" ");
  });
  const allArgs = args.join(" ");
  result = result.replace(/\$ARGUMENTS/g, allArgs);
  result = result.replace(/\$@/g, allArgs);
  return result;
}
