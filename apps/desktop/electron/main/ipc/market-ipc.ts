import {
  IPC,
  ErrorCodes,
  trustedExtensionCommandId,
  trustedExtensionCommandName,
  piPackageFromPluginId,
} from "@pi-desktop/shared";
import { builtinPaletteItems } from "../builtin-commands";
import type { AgentExtensionBridge } from "../agent-extensions";
import type { HostProcess } from "../host-process";
import type { PluginRuntime } from "../plugin-runtime";
import { applyPiPackageUpdates, installPiPackage, piPackageUpdates } from "../pi-package-install";
import type { IpcRegistrar } from "./types";

export type MarketIpcDependencies = {
  registrar: IpcRegistrar;
  getHost: () => HostProcess | null;
  plugins: PluginRuntime;
  agentExtensions: AgentExtensionBridge;
  optionalWorkspaceRoot: () => Promise<string | null>;
  pluginActiveInProject: (pluginId: string, projectPath: string | null | undefined) => boolean;
  sendToRenderer: (channel: string, payload?: unknown) => void;
  /** Where staged npm trees and generated plugin directories live. */
  dataDir: string;
  log: (message: string, data?: Record<string, unknown>) => void;
};

/** Register marketplace and command palette channels. */
export function registerMarketIpc({
  registrar,
  getHost,
  plugins,
  agentExtensions,
  optionalWorkspaceRoot,
  pluginActiveInProject,
  sendToRenderer,
  dataDir,
  log,
}: MarketIpcDependencies): void {
  let host: HostProcess | null = null;
  const handle = (channel: string, fn: (...args: any[]) => Promise<any>) => {
    registrar.handle(channel, async (...args) => {
      host = getHost();
      return fn(...args);
    });
  };

  /** Dependencies for the official-package (npm) install pipeline. */
  const piPackageDeps = () => {
    if (!host) throw new Error("host unavailable");
    const client = host;
    return {
      call: <T>(method: string, params?: unknown) => client.call<T>(method, params),
      loadFromPath: (path: string, permissions: string[], options?: { development?: boolean }) =>
        plugins.loadFromPath(path, permissions, options),
      dataDir,
      log,
    };
  };

  const drainToasts = () => {
    for (const toast of plugins.drainToasts()) {
      sendToRenderer(IPC.event.toast, { message: toast });
    }
  };

  handle(IPC.invoke.marketRefresh, async (payload?: { force?: boolean }) => {
    if (!host) throw new Error("host unavailable");
    return host.call("market.refresh", { force: payload?.force ?? true });
  });

  handle(IPC.invoke.marketSearch, async (payload?: { query?: string; category?: string }) => {
    if (!host) throw new Error("host unavailable");
    return host.call("market.search", {
      query: payload?.query ?? "",
      category: payload?.category ?? "",
    });
  });

  handle(IPC.invoke.marketGetDetail, async (id: string) => {
    if (!host) throw new Error("host unavailable");
    return host.call("market.getDetail", { id });
  });

  handle(
    IPC.invoke.marketInstall,
    async (payload: {
      id: string;
      version?: string;
      enable?: boolean;
      autoUpdate?: boolean;
      grantedPermissions?: string[];
      publisherId?: string;
      trust?: string;
    }) => {
      if (!host) throw new Error("host unavailable");
      // An official pi package is installed by this app's npm pipeline; every
      // other market id names a package the host downloads itself. The id
      // decides, because the id is what the market listed and what the install
      // records.
      const packageName = piPackageFromPluginId(payload?.id ?? "");
      if (packageName) {
        const installed = await installPiPackage(piPackageDeps(), {
          pluginId: payload.id,
          packageName,
          version: payload.version,
          grantedPermissions: payload.grantedPermissions ?? [],
          autoUpdate: payload.autoUpdate ?? false,
          publisherId: payload.publisherId,
          trust: payload.trust,
        });
        drainToasts();
        sendToRenderer(IPC.event.pluginChanged, {
          reason: "market.install",
          pluginId: payload.id,
        });
        return { result: installed };
      }
      const installed = await host.call<{ result: any }>("market.install", payload);
      const plugin = installed.result?.plugin;
      if (plugin?.enabled && plugin?.path) {
        await plugins.loadFromPath(plugin.path, plugin.permissions ?? []);
      }
      drainToasts();
      sendToRenderer(IPC.event.pluginChanged, {
        reason: "market.install",
        pluginId: payload.id,
      });
      return installed;
    },
  );

  handle(
    IPC.invoke.marketCheckUpdates,
    async (payload?: { refreshRemote?: boolean }) => {
      if (!host) throw new Error("host unavailable");
      return host.call("market.checkUpdates", {
        refreshRemote: payload?.refreshRemote ?? true,
      });
    },
  );

  handle(IPC.invoke.marketApplyUpdates, async (payload?: { onlyAuto?: boolean }) => {
    if (!host) throw new Error("host unavailable");
    const onlyAuto = payload?.onlyAuto ?? true;
    // The host applies the catalog installs and resolves the pending official
    // package versions; the npm pipeline applies those, because only it can
    // materialize a package.
    const applied = await host.call<{ results: any[]; plugins: any[] }>("market.applyUpdates", {
      onlyAuto,
    });
    for (const item of applied.results ?? []) {
      const plugin = item?.plugin;
      if (plugin?.enabled && plugin?.path) {
        await plugins.loadFromPath(plugin.path, plugin.permissions ?? []);
      }
    }
    const pending = piPackageUpdates(applied.plugins ?? [], onlyAuto);
    if (pending.length > 0) {
      const { results, failures } = await applyPiPackageUpdates(piPackageDeps(), pending);
      for (const failure of failures) {
        // A package that could not be applied is reported rather than silently
        // dropped; the others still land.
        sendToRenderer(IPC.event.toast, { message: failure.error });
      }
      sendToRenderer(IPC.event.pluginChanged, { reason: "market.applyUpdates" });
      drainToasts();
      return { ...applied, results: [...(applied.results ?? []), ...results] };
    }
    sendToRenderer(IPC.event.pluginChanged, { reason: "market.applyUpdates" });
    return applied;
  });

  handle(IPC.invoke.commandPaletteSearch, async (query: string) => {
    const q = (query || "").toLowerCase();
    const builtin = builtinPaletteItems();
    const root = await optionalWorkspaceRoot();
    const pluginCmds = plugins
      .getCommands()
      .filter((c) => pluginActiveInProject(c.pluginId, root))
      .map((c) => ({
        id: c.id,
        title: c.title,
        category: c.category,
        keywords: c.keywords,
        source: "plugin" as const,
        pluginId: c.pluginId,
      }));
    const extensionCmds = agentExtensions.allCommands().map((c) => ({
      id: trustedExtensionCommandId(c.name),
      title: `/${c.name}`,
      category: c.extensionLabel,
      keywords: c.description ? [c.description] : [],
      source: "extension" as const,
      extensionId: c.extensionId,
    }));
    return {
      commands: [...builtin, ...pluginCmds, ...extensionCmds].filter((c) => {
        if (!q) return true;
        const hay = `${c.title} ${c.category ?? ""} ${(c as any).keywords?.join(" ") ?? ""}`.toLowerCase();
        return hay.includes(q);
      }),
    };
  });

  handle(IPC.invoke.commandPaletteExecute, async (commandId: string) => {
    if (commandId.startsWith("builtin.")) {
      return { ok: true, commandId };
    }
    if (trustedExtensionCommandName(commandId) !== undefined) {
      // Extension commands need a session; the renderer routes them through
      // `extensions/commands/run` with the active session id.
      throw Object.assign(new Error("extension commands run inside a session"), {
        errorCode: ErrorCodes.INVALID_ARGUMENT,
      });
    }
    const cmd = plugins.getCommands().find((c) => c.id === commandId);
    if (!cmd) throw new Error("command not found");
    // A command can be typed into the composer by name, so the scope has to be
    // re-checked here and not only where the lists are built.
    if (!pluginActiveInProject(cmd.pluginId, await optionalWorkspaceRoot())) {
      throw Object.assign(new Error("command not available in this project"), {
        errorCode: ErrorCodes.NOT_FOUND,
      });
    }
    await cmd.run();
    drainToasts();
    return { ok: true, commandId };
  });
}
