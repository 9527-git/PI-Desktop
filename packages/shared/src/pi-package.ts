/**
 * The official pi package catalog, as the desktop app needs to name it.
 *
 * Every official pi package is an npm package whose `package.json` declares
 * what the pi CLI loads from it. The host owns the catalog listing (it reads the
 * npm registry; see `crates/host-core/src/plugins/marketplace/pi_packages.rs`),
 * and the main process owns materializing a package with npm. Both sides have to
 * agree on two things, which live here:
 *
 * - which npm package a market entry names, and
 * - the plugin id that package is installed under.
 *
 * The id is the only handle the renderer passes back, so the mapping is
 * injective and its output satisfies the published plugin id contract
 * (`^[a-z0-9]+(\.[a-z0-9_-]+)+$`, docs/spec/07-plugins/02-plugin-manifest-schema.md):
 * `foo` becomes `pidev.pkg.foo`, `@scope/name` becomes
 * `pidev.scope.<scope>.<name>`. The Rust side implements the same mapping and
 * pins the same examples in its tests, so a change here is a contract change.
 */

/** Market source URL of the official pi package catalog. */
export const PI_PACKAGE_SOURCE_URL = "https://pi.dev/packages";

/** Provider id reported by the host and recorded on installed plugins. */
export const PI_PACKAGE_PROVIDER_ID = "pidev";

/** Prefix of every plugin id this source installs. */
export const PI_PACKAGE_ID_PREFIX = "pidev.";

/** npm keyword every official pi package carries. */
export const PI_PACKAGE_KEYWORD = "pi-package";

/** Registry the official catalog is published to. */
export const NPM_REGISTRY_URL = "https://registry.npmjs.org";

/** npm name segment: URL-safe, and encodable as a plugin id segment. */
const PACKAGE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Whether a string is an npm package name this app will fetch.
 *
 * A name reaches a registry URL, an npm argument, and a plugin id, so only the
 * lowercase URL-safe alphabet with an optional `@scope/` is accepted. npm allows
 * more than this (a leading `-` or `_`, `~`, a dotted scope); those are refused
 * rather than accepted and then mangled, because the id could not name them
 * back.
 */
export function isValidPiPackageName(name: string): boolean {
  if (!name || name.length > 214 || name.trim() !== name) return false;
  const scoped = name.startsWith("@");
  const body = scoped ? name.slice(1) : name;
  const parts = body.split("/");
  if (scoped ? parts.length !== 2 : parts.length !== 1) return false;
  const [scope, rest] = scoped ? parts : [undefined, parts[0]];
  // A dotted scope cannot be told apart from the package name once it is
  // encoded, so it is not a name this source can represent.
  if (scope !== undefined && scope.includes(".")) return false;
  return (scope === undefined || PACKAGE_SEGMENT.test(scope)) && PACKAGE_SEGMENT.test(rest);
}

/** Plugin id one npm package installs under. */
export function piPluginIdForPackage(name: string): string {
  const scoped = name.startsWith("@") ? name.slice(1).split("/") : undefined;
  if (scoped && scoped.length === 2) {
    return `${PI_PACKAGE_ID_PREFIX}scope.${scoped[0]}.${scoped[1]}`;
  }
  return `${PI_PACKAGE_ID_PREFIX}pkg.${name}`;
}

/**
 * npm package a plugin id names, or `null` when the id is not this source's.
 *
 * `null` is the answer for another provider's plugin and for a half-written id,
 * so a caller can use it as the "is this an official pi package?" test.
 */
export function piPackageFromPluginId(pluginId: string): string | null {
  if (!pluginId.startsWith(PI_PACKAGE_ID_PREFIX)) return null;
  const rest = pluginId.slice(PI_PACKAGE_ID_PREFIX.length);
  let name: string;
  if (rest.startsWith("pkg.")) {
    name = rest.slice("pkg.".length);
  } else if (rest.startsWith("scope.")) {
    const separator = rest.indexOf(".", "scope.".length);
    if (separator < 0) return null;
    name = `@${rest.slice("scope.".length, separator)}/${rest.slice(separator + 1)}`;
  } else {
    return null;
  }
  return isValidPiPackageName(name) ? name : null;
}

/**
 * npm argument that installs exactly one package version.
 *
 * An empty version asks for whatever the registry currently calls latest, which
 * is what a listing entry offers before its document has been read.
 */
export function piPackageInstallSpec(name: string, version?: string): string {
  const trimmed = version?.trim() ?? "";
  return trimmed ? `${name}@${trimmed}` : name;
}

/** What a package declares for the pi CLI (`package.json` `pi` field). */
export type PiPackageManifest = {
  extensions?: unknown;
  skills?: unknown;
  prompts?: unknown;
};

/** Non-empty string entries of one `pi` declaration list. */
export function piDeclaredPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Whether the app can turn a package into a plugin.
 *
 * Mirrors the conversion in `electron/main/agent-extensions.ts`: declared
 * extensions and skills become plugin contributions, and nothing else does.
 */
export function piManifestSupportsInstall(manifest: PiPackageManifest | undefined): boolean {
  if (!manifest) return false;
  return (
    piDeclaredPaths(manifest.extensions).length > 0 || piDeclaredPaths(manifest.skills).length > 0
  );
}

/**
 * Permissions the conversion declares for a package.
 *
 * Kept identical to `generateImportedExtensionPlugin`: an extension runs inside
 * the agent, a skill injects into the prompt. The consent dialog shows this set
 * before anything is downloaded, and the host refuses the install if the package
 * that actually arrives asks for more.
 */
export function piManifestPermissions(manifest: PiPackageManifest | undefined): string[] {
  const permissions: string[] = [];
  if (!manifest) return permissions;
  if (piDeclaredPaths(manifest.extensions).length > 0) permissions.push("agent.extension");
  if (piDeclaredPaths(manifest.skills).length > 0) permissions.push("agent.prompt.inject");
  return permissions;
}
