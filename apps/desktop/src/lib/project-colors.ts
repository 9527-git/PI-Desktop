// Explicit extension keeps this module runnable in Node's TS test loader.
import { normalizeProjectColor, normalizeProjectPath } from "./sidebar-preferences.ts";

/**
 * Sidebar project colors. The palette order defines the automatic assignment
 * ring; explicit choices are stored per project in the sidebar preferences.
 */
export const PROJECT_COLOR_PALETTE = [
  { id: "blue", hex: "#5b9dff" },
  { id: "cyan", hex: "#3fb6d8" },
  { id: "teal", hex: "#2fbfa3" },
  { id: "green", hex: "#46c98b" },
  { id: "amber", hex: "#e2a33f" },
  { id: "orange", hex: "#e8814a" },
  { id: "red", hex: "#ef6b6b" },
  { id: "pink", hex: "#e07ab5" },
  { id: "purple", hex: "#a78bff" },
  { id: "slate", hex: "#93a0b4" },
] as const;

/** FNV-1a over the normalized path: stable across restarts and platforms. */
function projectColorSlot(path: string): number {
  const normalized = normalizeProjectPath(path) ?? path;
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % PROJECT_COLOR_PALETTE.length;
}

/**
 * Color for one project row. An explicit preference wins; otherwise the path
 * hash seeds a slot and the search probes forward past `used` (the colors other
 * rows already claimed in this pass) so neighboring projects stay distinct.
 */
export function resolveProjectColor(
  path: string,
  explicit: string | undefined,
  used: ReadonlySet<string>,
): { color: string; auto: boolean } {
  const preferred = normalizeProjectColor(explicit);
  if (preferred) return { color: preferred, auto: false };
  const start = projectColorSlot(path);
  for (let offset = 0; offset < PROJECT_COLOR_PALETTE.length; offset += 1) {
    const { hex } = PROJECT_COLOR_PALETTE[(start + offset) % PROJECT_COLOR_PALETTE.length];
    if (!used.has(hex)) return { color: hex, auto: true };
  }
  return { color: PROJECT_COLOR_PALETTE[start].hex, auto: true };
}
