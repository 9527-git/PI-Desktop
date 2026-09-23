#!/usr/bin/env node
/**
 * Official pi package marketplace E2E (headless protocol-level).
 *
 * The pi.dev catalog is the npm registry, so this suite points the host at a
 * local registry fixture and drives the market RPCs against it:
 *
 *   E2E-PLUGIN-PACKAGE-MARKET-SOURCE-SELECTION  `pidev` settings value selects
 *                                               the official package source and
 *                                               is reported as providerId/sourceUrl
 *   E2E-PLUGIN-PACKAGE-MARKET-LISTING           search hits map to plugin ids
 *                                               and stay uninstallable until the
 *                                               package document is read
 *   E2E-PLUGIN-PACKAGE-MARKET-DETAIL            detail reads versions, readme and
 *                                               the permissions the install asks for
 *   E2E-PLUGIN-PACKAGE-MARKET-UNSUPPORTED       a package declaring nothing this
 *                                               release can load says why
 *   E2E-PLUGIN-PACKAGE-MARKET-HOST-BOUNDARY     the host refuses to install an npm
 *                                               package itself; the app's npm
 *                                               pipeline owns that step
 *
 * Env: PI_DESKTOP_HOST_BIN (optional), DEBUG_HOST for tracing.
 * Deterministic: the registry is a local HTTP fixture, never the real npm.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION } from "../packages/shared/dist/protocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const hostBinCandidates = [];
const configuredHostBin = process.env.PI_DESKTOP_HOST_BIN?.trim();
if (configuredHostBin) {
  const configured = resolve(configuredHostBin);
  hostBinCandidates.push(configured);
  if (process.platform === "win32" && !configured.toLowerCase().endsWith(".exe")) {
    hostBinCandidates.push(`${configured}.exe`);
  }
}
const hostBinaryName = `pi-desktop-host-core${process.platform === "win32" ? ".exe" : ""}`;
hostBinCandidates.push(join(root, "target", "debug", hostBinaryName));
hostBinCandidates.push(join(root, "..", "..", "..", "target", "debug", hostBinaryName));
const hostBin = hostBinCandidates.find((candidate) => existsSync(candidate));

if (!hostBin) {
  console.error("host binary missing; tried:", hostBinCandidates.join(", "));
  process.exit(1);
}

const results = [];
function record(id, ok, detail = "") {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? `  — ${detail}` : ""}`);
}

class Host {
  constructor(bin, dataDir, home, env = {}) {
    this.child = spawn(bin, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: home,
        PI_DESKTOP_DATA_DIR: dataDir,
        ...env,
      },
    });
    this.pending = new Map();
    this.child.stderr.on("data", (chunk) => {
      if (process.env.DEBUG_HOST) process.stderr.write(chunk);
    });
    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id != null && this.pending.has(String(msg.id))) {
        const pending = this.pending.get(String(msg.id));
        this.pending.delete(String(msg.id));
        if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
        else pending.resolve(msg.result);
      }
    });
    this.child.on("exit", (code) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`host exited code=${code}`));
      }
      this.pending.clear();
    });
  }
  call(method, params = {}) {
    const id = randomUUID();
    return new Promise((resolveCall, reject) => {
      this.pending.set(String(id), { resolve: resolveCall, reject });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => {
        if (this.pending.has(String(id))) {
          this.pending.delete(String(id));
          reject(new Error(`timeout ${method}`));
        }
      }, 30_000);
    });
  }
  dispose() {
    this.child.kill("SIGTERM");
  }
}

/** One published version of a fixture package. */
function versionDocument(name, version, pi) {
  return {
    [version]: {
      version,
      pi,
      dist: {
        shasum: "a".repeat(40),
        tarball: `https://registry.npmjs.org/${name}/-/${version}.tgz`,
        unpackedSize: 1024,
      },
    },
  };
}

function packageDocument({ name, version, pi, readme }) {
  return {
    name,
    "dist-tags": { latest: version },
    license: "MIT",
    readme,
    maintainers: [{ username: "fixture-author" }],
    time: { created: "2026-01-01T00:00:00.000Z", [version]: "2026-09-01T00:00:00.000Z" },
    versions: versionDocument(name, version, pi),
  };
}

const EXTENSION_PACKAGE = "@fixture/pi-plan-mode";
const PROMPTS_ONLY_PACKAGE = "fixture-prompts-only";
const LISTING_PACKAGE = "fixture-web-access";

const registryDocuments = new Map([
  [
    EXTENSION_PACKAGE,
    packageDocument({
      name: EXTENSION_PACKAGE,
      version: "0.2.0",
      pi: { extensions: ["./dist/index.ts"] },
      readme: "# Plan mode\n\nRead-only collaboration mode.",
    }),
  ],
  [
    PROMPTS_ONLY_PACKAGE,
    packageDocument({
      name: PROMPTS_ONLY_PACKAGE,
      version: "1.0.0",
      pi: { prompts: ["./prompts"] },
      readme: "# Prompts\n",
    }),
  ],
]);

/** Minimal npm registry: search plus one document per package. */
function startRegistry() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/-/v1/search") {
      // A search hit carries the latest version and no `pi` manifest, which is
      // exactly what the real registry returns.
      send({
        objects: [
          {
            downloads: { monthly: 429774 },
            package: {
              name: LISTING_PACKAGE,
              version: "0.30.0",
              description: "Web search for the Pi coding agent.",
              keywords: ["pi-package", "pi", "web-search"],
              publisher: { username: "fixture-author" },
              date: "2026-09-19T14:25:30.716Z",
              links: { npm: `https://www.npmjs.com/package/${LISTING_PACKAGE}` },
            },
          },
        ],
        total: 1,
      });
      return;
    }
    const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const document = registryDocuments.get(name);
    if (document) {
      send(document);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
  return new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveListen({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

const { server, base } = await startRegistry();
const home = mkdtempSync(join(tmpdir(), "pi-desktop-pkg-e2e-"));
const dataDir = mkdtempSync(join(tmpdir(), "pi-desktop-pkg-e2e-data-"));
let host = null;

try {
  host = new Host(hostBin, dataDir, home, { PI_DESKTOP_NPM_REGISTRY_URL: base });
  await host.call("app.handshake", { protocolVersion: PROTOCOL_VERSION });
  await host.call("settings.set", { pluginMarketSource: "pidev" });

  // ── E2E-PLUGIN-PACKAGE-MARKET-SOURCE-SELECTION ─────────────────────────────
  {
    const refreshed = await host.call("market.refresh", { force: true });
    const searched = await host.call("market.search", { query: "" });
    const ok =
      refreshed?.providerId === "pidev" &&
      refreshed?.sourceUrl === "https://pi.dev/packages" &&
      searched?.providerId === "pidev" &&
      searched?.sourceUrl === "https://pi.dev/packages" &&
      refreshed?.pluginCount >= 1;
    record(
      "E2E-PLUGIN-PACKAGE-MARKET-SOURCE-SELECTION",
      ok,
      ok
        ? `${refreshed.pluginCount} packages listed from the registry fixture`
        : JSON.stringify({ refreshed, providerId: searched?.providerId }),
    );
  }

  // ── E2E-PLUGIN-PACKAGE-MARKET-LISTING ─────────────────────────────────────
  {
    const searched = await host.call("market.search", { query: "" });
    const row = (searched?.plugins ?? []).find((plugin) => plugin.npmPackage === LISTING_PACKAGE);
    // A listing entry has not been read yet: it must not offer an install that
    // would ask for consent to a permission list nobody derived.
    const ok =
      row?.id === `pidev.pkg.${LISTING_PACKAGE}` &&
      row?.installable === false &&
      row?.installBlocked === "not_read" &&
      row?.providerId === "pidev" &&
      row?.trust === "community" &&
      row?.verified === false;
    record(
      "E2E-PLUGIN-PACKAGE-MARKET-LISTING",
      ok,
      ok ? `id=${row.id} installBlocked=${row.installBlocked}` : JSON.stringify(row ?? null),
    );
  }

  // ── E2E-PLUGIN-PACKAGE-MARKET-DETAIL ──────────────────────────────────────
  {
    const id = `pidev.scope.fixture.pi-plan-mode`;
    const detail = (await host.call("market.getDetail", { id }))?.plugin;
    const version = detail?.versions?.[0];
    const ok =
      detail?.id === id &&
      detail?.npmPackage === EXTENSION_PACKAGE &&
      detail?.installable === true &&
      detail?.installBlocked === undefined &&
      detail?.author === "fixture-author" &&
      detail?.trust === "community" &&
      detail?.permissions?.length === 1 &&
      detail?.permissions?.[0] === "agent.extension" &&
      version?.version === "0.2.0" &&
      version?.permissions?.[0] === "agent.extension" &&
      typeof detail?.readmeMarkdown === "string" &&
      detail.readmeMarkdown.includes("Plan mode");
    record(
      "E2E-PLUGIN-PACKAGE-MARKET-DETAIL",
      ok,
      ok
        ? `v${version.version} permissions=${JSON.stringify(detail.permissions)}`
        : JSON.stringify({ id: detail?.id, permissions: detail?.permissions, version }),
    );
  }

  // ── E2E-PLUGIN-PACKAGE-MARKET-UNSUPPORTED ─────────────────────────────────
  {
    const id = `pidev.pkg.${PROMPTS_ONLY_PACKAGE}`;
    const detail = (await host.call("market.getDetail", { id }))?.plugin;
    const ok =
      detail?.installable === false &&
      detail?.installBlocked === "unsupported" &&
      // Nothing installable means no package metadata to offer.
      (detail?.versions ?? []).every((version) => !version.url && !version.shasum) &&
      typeof detail?.safetyNotes === "string" &&
      detail.safetyNotes.length > 0;
    record(
      "E2E-PLUGIN-PACKAGE-MARKET-UNSUPPORTED",
      ok,
      ok ? detail.safetyNotes : JSON.stringify({ detail }),
    );
  }

  // ── E2E-PLUGIN-PACKAGE-MARKET-HOST-BOUNDARY ───────────────────────────────
  {
    const id = `pidev.pkg.${LISTING_PACKAGE}`;
    let refused = "";
    try {
      await host.call("market.install", { id, enable: true });
    } catch (error) {
      refused = error.message;
    }
    const ok = refused.includes("PLUGIN_INSTALL_UNSUPPORTED");
    record(
      "E2E-PLUGIN-PACKAGE-MARKET-HOST-BOUNDARY",
      ok,
      ok ? "host refused; the npm pipeline owns this install" : refused || "no refusal",
    );
  }
} catch (error) {
  record("E2E-PLUGIN-PACKAGE-MARKET-SUITE", false, error.message);
} finally {
  host?.dispose();
  server.close();
  // The host child may still hold its data directory open for a moment on
  // Windows; cleanup is best effort so it never masks the scenario results.
  const cleanup = (path) => {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      setTimeout(() => rmSync(path, { recursive: true, force: true, maxRetries: 5 }), 500);
    }
  };
  setTimeout(() => cleanup(home), 200);
  setTimeout(() => cleanup(dataDir), 500);
}
const failed = results.filter((result) => !result.ok);
console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
