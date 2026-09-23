/**
 * Installation of official pi packages (spec 07-plugins/07-plugin-marketplace.md).
 *
 * An official pi package is an npm package, so the desktop app installs it the
 * way npm does and registers the result as an ordinary installed plugin. The
 * Rust host cannot do this part: it has no gzip/tar unpacker, and its package
 * downloads are held to a distribution-host allowlist — npm, not the host, owns
 * registry resolution, the dependency policy, and the disabled lifecycle
 * scripts (`npm-installer.ts`). The host keeps what it owns: the registry entry,
 * the provenance, and the update state.
 *
 * The conversion from package to plugin is the one already used to import a pi
 * extension (`generateImportedExtensionPlugin`), so a package that arrives here
 * is subject to the same checks — sensitive files and symlinks rejected,
 * `node_modules` never copied, dependencies reinstalled from the declared
 * manifest rather than trusted as they came.
 *
 * Order matters: the host copies the generated directory into its installed
 * root, and that copy drops `node_modules`. Dependencies are therefore installed
 * into the installed directory after registration, and a failure there is
 * reported without discarding the install.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PI_PACKAGE_PROVIDER_ID, piPluginIdForPackage } from "@pi-desktop/shared";
import { generateImportedExtensionPlugin } from "./agent-extensions.js";
import { installExtensionDependencies, type ExtensionDependencyInstallResult } from "./npm-installer.js";

export type PiPackageInstallDeps = {
  /** Host RPC client. */
  call: <T>(method: string, params?: unknown) => Promise<T>;
  /** Plugin runtime, for loading the plugin after the host registers it. */
  loadFromPath: (
    path: string,
    permissions: string[],
    options?: { development?: boolean },
  ) => Promise<unknown>;
  /** Where staged npm trees and generated plugin directories live. */
  dataDir: string;
  /** App-level log line for one install attempt. */
  log: (message: string, fields?: { pluginId?: string; event?: string; data?: unknown }) => void;
};

export type PiPackageInstallInput = {
  /** Plugin id the market listed, e.g. `pidev.pkg.bigworksheets`. */
  pluginId: string;
  packageName: string;
  /** Exact version to install; empty asks the registry for its latest. */
  version?: string;
  /** Permissions the user accepted in the install dialog. */
  grantedPermissions: string[];
  autoUpdate: boolean;
  /** Enabled state to keep: an update must not re-enable a disabled plugin. */
  enable?: boolean;
  /** Publisher recorded with the install, when the market named one. */
  publisherId?: string;
  trust?: string;
};

export type PiPackageInstallResult = {
  plugin: {
    id?: string;
    path?: string;
    version?: string;
    permissions?: string[];
    enabled?: boolean;
  };
  upgraded: boolean;
  dependencies: ExtensionDependencyInstallResult;
};

/** Registry entry recorded on the installed plugin. */
function marketplaceMeta(input: PiPackageInstallInput) {
  return {
    providerId: PI_PACKAGE_PROVIDER_ID,
    shasum: null,
    publisherId: input.publisherId ?? null,
    // The registry says who published a package; it cannot vouch for it, so the
    // tier the market rendered is what the install keeps.
    trust: input.trust ?? "community",
    npmPackage: input.packageName,
  };
}
/**
 * One npm tree holding exactly the package being installed.
 *
 * A package is materialized by asking npm for it from a directory whose only
 * dependency is that package: npm then applies its own resolution, integrity
 * checks, and registry pin, which is what makes this safer than fetching a
 * tarball by hand.
 */
async function materializePackage(
  deps: PiPackageInstallDeps,
  input: PiPackageInstallInput,
  stageRoot: string,
): Promise<string> {
  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true });
  writeFileSync(
    join(stageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "pi-desktop-npm-install",
        private: true,
        version: "0.0.0",
        dependencies: { [input.packageName]: input.version?.trim() || "latest" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const installed = await installExtensionDependencies(stageRoot);
  if (installed.state === "failed") {
    throw new Error(`npm could not install ${input.packageName}: ${installed.error}`);
  }
  // npm's own layout: scoped packages nest one level under their scope.
  const packageDir = join(stageRoot, "node_modules", ...input.packageName.split("/"));
  if (!existsSync(join(packageDir, "package.json"))) {
    throw new Error(`npm did not provide ${input.packageName}`);
  }
  return packageDir;
}

/** Package identity as the published package declares it. */
function readPackageIdentity(packageDir: string): {
  name?: string;
  version?: string;
  description?: string;
} {
  try {
    const parsed = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
      description?: unknown;
    };
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
    };
  } catch {
    // A package with unreadable metadata still installs; the host reports the
    // manifest it finds.
    return {};
  }
}

/**
 * Install or update one official pi package.
 *
 * Throws with the underlying reason so the renderer can surface it: a failed
 * npm install, a package that cannot be converted, or a host refusal (a
 * permission the user did not grant, an id the registry cannot name).
 */
export async function installPiPackage(
  deps: PiPackageInstallDeps,
  input: PiPackageInstallInput,
): Promise<PiPackageInstallResult> {
  const slug = input.packageName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const stageRoot = join(deps.dataDir, "plugins/npm/stage", slug);
  const generateRoot = join(deps.dataDir, "plugins/npm/generated");
  let generated: { path: string; id: string } | undefined;
  try {
    const packageDir = await materializePackage(deps, input, stageRoot);
    const identity = readPackageIdentity(packageDir);
    // The id the market listed the plugin under, so the installed plugin keeps
    // the identity the user saw. `generateImportedExtensionPlugin` defaults to
    // its own import id, which would install the same package twice.
    const id = piPluginIdForPackage(input.packageName);
    if (id !== input.pluginId) {
      throw new Error(`plugin id ${input.pluginId} does not name ${input.packageName}`);
    }
    generated = generateImportedExtensionPlugin(packageDir, generateRoot, {
      id,
      name: identity.name ?? input.packageName,
      version: identity.version ?? input.version,
      description: identity.description,
    });

    const registered = await deps.call<{ result: PiPackageInstallResult }>(
      "plugins.installFromPath",
      {
        path: generated.path,
        enable: input.enable ?? true,
        source: "marketplace",
        autoUpdate: input.autoUpdate,
        grantedPermissions: input.grantedPermissions,
        marketplace: marketplaceMeta(input),
      },
    );
    const plugin = registered.result?.plugin ?? {};
    // Dependencies are reinstalled inside the installed plugin, because the
    // host's copy deliberately leaves `node_modules` behind.
    const dependencies: ExtensionDependencyInstallResult = plugin.path
      ? await installExtensionDependencies(plugin.path)
      : { state: "skipped", reason: "no-package-json" };
    if (plugin.path && plugin.enabled !== false) {
      await deps.loadFromPath(plugin.path, plugin.permissions ?? [], { development: false });
    }
    deps.log("pi package installed", {
      pluginId: plugin.id,
      event: "plugin.piPackage.installed",
      data: {
        package: input.packageName,
        version: plugin.version,
        dependencies: dependencies.state,
      },
    });
    return { plugin, upgraded: registered.result?.upgraded ?? false, dependencies };
  } finally {
    // The staged npm tree and the generated directory are inputs, not state:
    // the installed plugin is the copy the host owns.
    rmSync(stageRoot, { recursive: true, force: true });
    if (generated?.path) rmSync(generated.path, { recursive: true, force: true });
  }
}

export type PiPackageUpdate = {
  id: string;
  packageName: string;
  version: string;
  permissions: string[];
  permissionDiff: string[];
  autoUpdate: boolean;
  /** The plugin's current enabled state, which the update keeps. */
  enabled: boolean;
  publisherId?: string;
  trust?: string;
};

/**
 * Pending official-package updates from the host's plugin list.
 *
 * The host resolves which versions are newer (it reads the registry and records
 * the update); main only decides which of them to apply now. A plugin installed
 * from any other source is skipped: `marketplace.npmPackage` is written only by
 * this pipeline, so it is what distinguishes an npm-backed install.
 */
export function piPackageUpdates(
  plugins: Array<{
    id?: string;
    version?: string;
    permissions?: string[];
    autoUpdate?: boolean;
    enabled?: boolean;
    marketplace?: { providerId?: string; npmPackage?: string; publisherId?: string; trust?: string };
    updateAvailable?: { version?: string; permissionDiff?: string[] };
  }>,
  onlyAuto: boolean,
): PiPackageUpdate[] {
  const updates: PiPackageUpdate[] = [];
  for (const plugin of plugins) {
    const packageName = plugin.marketplace?.npmPackage;
    if (!plugin.id || !packageName || plugin.marketplace?.providerId !== PI_PACKAGE_PROVIDER_ID) {
      continue;
    }
    const version = plugin.updateAvailable?.version;
    if (!version) continue;
    const permissionDiff = plugin.updateAvailable?.permissionDiff ?? [];
    // An automatic pass never widens permissions on its own, which is the same
    // rule the catalog path applies.
    if (onlyAuto && permissionDiff.length > 0) continue;
    const autoUpdate = plugin.autoUpdate ?? false;
    if (onlyAuto && !autoUpdate) continue;
    updates.push({
      id: plugin.id,
      packageName,
      version,
      permissions: plugin.permissions ?? [],
      permissionDiff,
      autoUpdate,
      enabled: plugin.enabled ?? true,
      publisherId: plugin.marketplace?.publisherId,
      trust: plugin.marketplace?.trust,
    });
  }
  return updates;
}

/** Apply the pending official-package updates the caller asked for. */
export async function applyPiPackageUpdates(
  deps: PiPackageInstallDeps,
  updates: PiPackageUpdate[],
): Promise<{
  results: PiPackageInstallResult[];
  failures: Array<{ id: string; error: string }>;
}> {
  const results: PiPackageInstallResult[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  for (const update of updates) {
    try {
      // The permissions the user already holds plus the ones the new version
      // adds: the host refuses an install whose manifest asks for more.
      const granted = [...update.permissions];
      for (const permission of update.permissionDiff) {
        if (!granted.includes(permission)) granted.push(permission);
      }
      results.push(
        await installPiPackage(deps, {
          pluginId: update.id,
          packageName: update.packageName,
          version: update.version,
          grantedPermissions: granted,
          autoUpdate: update.autoUpdate,
          enable: update.enabled,
          publisherId: update.publisherId,
          trust: update.trust,
        }),
      );
    } catch (error) {
      // One package that cannot be applied must not abort the rest, and the
      // reason has to reach the user rather than being swallowed.
      failures.push({ id: update.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, failures };
}
