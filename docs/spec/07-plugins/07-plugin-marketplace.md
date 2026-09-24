# 07. Plugin Marketplace

## 1. Positioning

The plugin marketplace is a **distribution layer**, not a runtime core.

Principle:

> Get the local plugin system working first, then integrate the marketplace.

The marketplace is responsible for:
- Discovery
- Search
- Displaying metadata
- Download
- Update checking

The host is responsible for:
- Validation
- Authorization
- Install
- Run
- Security isolation

## 2. Phase strategy

### Phase A ✅
- Protocol and data model
- Local official market provider (`plugins/market/catalog.json`)

### Phase B ✅
- Browse/search + download install are implemented against the official provider
- Official provider is the dedicated GitHub repo `vastsa/pi-desktop-plugins`
- Default catalog URL: `https://raw.githubusercontent.com/vastsa/pi-desktop-plugins/main/catalog.json`
- Package URLs may be absolute `https://` / `http://` / `file://`, or relative paths resolved against the catalog URL
- HTTPS fetch uses `curl` in host-core
- curl diagnostics are decoded as UTF-8 first and as the active Windows ANSI
  code page when needed; a network failure remains `PLUGIN_NETWORK`, but its
  localized message must not cross the RPC boundary as replacement characters

### Catalog source selection

Plugins → Marketplace picks where the catalog comes from. host-core resolves
the URL with the environment override on top, so dev builds and tests can point
at a local catalog without touching persisted settings:

| Precedence | Source | Value |
| --- | --- | --- |
| 1 | `PI_DESKTOP_PLUGIN_MARKET_URL` | any URL |
| 2 | `pluginMarketSource: "mirror"` | `https://cnb.cool/aixk/pi-desktop-plugins/-/git/raw/main/catalog.json` |
| 2 | `pluginMarketSource: "custom"` | `pluginMarketCustomUrl` |
| 2 | `pluginMarketSource: "pidev"` | `https://pi.dev/packages` |
| 3 | `pluginMarketSource: "official"` (default) | the default catalog URL above |

The mirror exists for networks that cannot reach `raw.githubusercontent.com`.
It serves a byte-identical catalog, and catalog package URLs are relative, so
`resolve_package_url` keeps package downloads on whichever source served the
catalog and shasum verification is unaffected by the switch.

Cached catalogs are keyed to their source in `plugins/market/cache-meta.json`.
A snapshot fetched from a different source is ignored rather than deleted —
its package URLs point at the provider the user just switched away from — so
switching back recovers that catalog without a round trip. `settings.set` only
re-pins the source in memory; fetching there would hold the host RPC state lock
behind a marketplace timeout, so the renderer triggers `market.refresh` after
the switch.

### Official pi package source (npm)

`pidev` selects the official pi package catalog published at
`https://pi.dev/packages`. That page is server-rendered HTML with no
machine-readable index, and every official pi package is an npm package whose
`package.json` declares what the pi CLI loads from it (`pi.extensions`,
`pi.skills`, `pi.prompts`). This source therefore reads the npm registry
instead: `https://registry.npmjs.org/-/v1/search?text=…+keywords:pi-package`
for listings and `https://registry.npmjs.org/<name>` for detail. The host
reports providerId `pidev` and source URL `https://pi.dev/packages` for it, and
`market.refresh` means "re-read the browse listing" here rather than caching a
catalog document. `PI_DESKTOP_NPM_REGISTRY_URL` overrides the registry base the
way `PI_DESKTOP_PLUGIN_MARKET_URL` overrides the catalog URL.

Listing and detail:

- Search is one page per query: 100 hits carrying the `pi-package` keyword.
  Browsing therefore shows the registry's own ordering, and the search box is
  the way to narrow it.
- A hit carries the package's latest version, description, publisher, monthly
  downloads, and homepage/repository links. It carries neither the package
  contents nor a checksum.
- Detail reads the package document: versions newest first and capped at 30 (a
  version without a tarball is left out), readme, homepage/repository, unpacked
  size, published date, publisher, and the permission list below.

Plugin id encoding:

- An npm package maps to a plugin id inside the published contract
  `^[a-z0-9]+(\.[a-z0-9_-]+)+$`: `foo` becomes `pidev.pkg.foo`, and
  `@scope/name` becomes `pidev.scope.<scope>.<name>`.
- A name is accepted only when it is URL- and id-safe: the lowercase registry
  alphabet with `-`, `_`, `.`, and an optional `@scope/`. Names npm allows but
  the id contract cannot represent (a leading `-`, `_`, or `.`, `~`, a dotted
  scope) are not offered by this source.

Permissions and trust:

- Permissions shown before install are derived from the same declarations the
  conversion reads: `pi.extensions` → `agent.extension`, `pi.skills` →
  `agent.prompt.inject`. A package that declares neither is listed but not
  installable, and the detail sheet says why.
- Trust is `community` for every entry and never `verified`: the registry says
  who published a package but cannot vouch for it.

Installable states:

- A listing entry is not installable until its package document has been read,
  so the install action lives in the plugin detail sheet, which shows the real
  permission list before the user accepts. Cards say "Open this plugin to
  install it".
- A read package that declares nothing this release can load reports
  `installBlocked: "unsupported"` with the reason; an unread listing reports
  `"not_read"`.
- A failed registry read surfaces as an error on the market surface.

### Client-visible catalog policy

Development-only sample entries whose stable ID starts with `demo.` remain
available as offline fixtures and direct install targets for plugin development,
but the desktop client filters them before updating its marketplace state. They
do not appear as cards, categories, or search results. An already-installed
sample remains visible in Installed so it can still be disabled or uninstalled.

### Bundled plugins in the catalog

An entry whose ID a build also ships from `resources/plugins` stays visible: the
card resolves against the bundled row, reports the installed version, and offers
an update when the catalog has a strictly newer one. That is the supported way
for a user to take a newer upstream release without waiting for an app update
(ADR 0241). Only a strictly newer version counts as an update — equality is not
one, and neither is an older catalog entry, which would be a downgrade wearing
the update affordance.

Updating a bundled plugin keeps it bundled. Removal stays refused by ID against
what the build ships, not by the row's `source`, so an updated plugin is still
not the user's to uninstall; and the installed version survives the next launch
unless this build ships a strictly newer one, so an app update still reaches a
user who never installed anything.

### Phase C (partial ✅)
- Auto-update policy + permission-diff gating implemented
- Ratings / mandatory signing still planned

### Phase D (in progress)

Plugin source moves to the publisher's own repository and the catalog gains
schema v2 (ADR 0102). The client reads v1 and v2 from the same code path; v2
adds source provenance, review verdicts, yank state, and a declared artifact
base. See [15-plugin-center.md](15-plugin-center.md) for the publishing side.

## 3. Market Provider abstraction

```ts
interface MarketProvider {
 id: string
 list(query: MarketQuery): Promise<MarketSearchResult>
 get(pluginId: string): Promise<MarketPluginDetail>
 getDownloadInfo(pluginId: string, version?: string): Promise<MarketDownloadInfo>
 checkUpdates(installed: InstalledPluginRef[]): Promise<MarketUpdateInfo[]>
}
```

Supports multiple providers:
- `official`
- `custom` (enterprise private source)
- `local-mock` (development)
- `pidev` (the official pi package catalog; reads the npm registry instead of a
  catalog document)

## 4. Data model

### Catalog schema v2

A catalog without `schemaVersion` is v1 and keeps its current meaning. `schemaVersion: 2`
adds the fields below; every one of them is optional so a v1 catalog parses
unchanged, and the client treats a missing field as "not asserted" rather than
as a default-allow.

Catalog `author` is a string in both v1 and v2. The plugin-manifest form
`{ name, url?, email? }` is valid on `manifest.json` and invalid in
`catalog.json`; host-core fails the whole refresh with `PLUGIN_MARKET_INVALID`
if it receives a map there.

```jsonc
{
  "schemaVersion": 2,
  "providerId": "official",
  "catalogId": "pi-plugin-center",
  "generatedAt": "2026-08-18T02:00:00Z",
  "policyVersion": "2026.08.1",
  // Optional. The official source omits it: relative package URLs resolve
  // against the catalog directory, so GitHub and the CNB mirror each serve
  // their own packages without crossing providers. A mirror or enterprise
  // source that stores packages elsewhere declares its own base here.
  "artifactBaseUrl": null,
  "plugins": [
    {
      "id": "acme.todo",
      "publisherId": "acme",
      "trust": "verified | community | unknown",
      "repository": "https://github.com/acme/pi-plugin-todo",
      "versions": [
        {
          "version": "1.2.0",
          "url": "packages/acme.todo-1.2.0.piplug",
          "shasum": "<sha256 hex>",
          "sizeBytes": 40960,
          "permissions": ["fs.read"],
          "minPiDesktop": "0.8.0",
          "yanked": false,
          "yankedReason": null,
          "provenance": {
            "sourceRepository": "https://github.com/acme/pi-plugin-todo",
            "sourceRef": "refs/tags/v1.2.0",
            "sourceCommit": "<40-hex commit>",
            "sourcePath": ".",
            "builder": "pi-plugin-center-builder@1.0.0",
            "builtAt": "2026-08-18T01:55:00Z"
          },
          "review": {
            "decision": "approved",
            "risk": "low",
            "policyVersion": "2026.08.1",
            "reviewedAt": "2026-08-18T01:58:00Z"
          },
          "signature": "<base64>",
          "signatureAlg": "ed25519",
          "keyId": "pi-center-2026"
        }
      ]
    }
  ]
}
```

Client rules for v2:

- `artifactBaseUrl` takes precedence over the catalog directory when resolving a
  relative package URL. An absolute package URL is used as given and must still
  pass the download host allowlist.
- `trust` is display-only and is never derived from publisher-supplied text. A
  value the client cannot attribute to the configured official source renders as
  `unknown`. See [15-plugin-center.md](15-plugin-center.md) §11.
- `yanked: true` removes the version from install and update selection. It stays
  visible in version history with its reason, and an installed copy of a yanked
  version is surfaced as needing attention.
- `minPiDesktop` blocks install when the running app is older, before download.
- `provenance` is stored with the installed plugin and shown in the detail sheet,
  so an installed marketplace plugin can be traced back to a repository and
  commit.
- `signature` verification is specified in
  [08-plugin-signing-updates.md](08-plugin-signing-updates.md) and remains
  optional until the center's signing phase lands. An unverifiable signature is
  never treated as a valid one.

### MarketPluginSummary
```ts
type MarketPluginSummary = {
 id: string
 name: string
 description: string
 author: string
 iconUrl?: string
 latestVersion: string
 downloads?: number
 updatedAt: string
 categories?: string[]
 permissionSummary: string[]
 verified?: boolean
 installable?: boolean
 installBlocked?: "not_read" | "unsupported"
 providerId?: string
 npmPackage?: string
}
```

### MarketPluginDetail
```ts
type MarketPluginDetail = MarketPluginSummary & {
 readmeMarkdown?: string
 versions: Array<{
 version: string
 publishedAt: string
 changelog?: string
 minPiDesktop?: string
 shasum?: string
 url?: string
 sizeBytes?: number
 }>
 screenshots?: string[]
 homepage?: string
 repository?: string
 permissions: string[]
 safetyNotes?: string
}
```

Version entries are an unordered catalog input. The host parses semantic
versions and selects the highest valid version as `latestVersion`; it does not
assume the first array entry is newest. Detail responses order versions newest
first, and an install without an explicit version targets that same latest
version. Invalid version strings are lower priority than valid semantic
versions. A version without `shasum` or `url` remains visible for discovery
but is not installable until the publisher completes its package metadata.

`installable` reports whether `latestVersion` carries that package metadata.
Marketplace rows and the detail sheet disable their install action and label
the version as not yet published rather than starting a download the host will
refuse; a batch update skips such a version instead of failing the whole run.

`installBlocked` explains an install action the source itself disables:
`not_read` while an official pi package has not been read yet, `unsupported`
when what the package declares is not something this release can load.
`providerId` names the source that offered the entry (`pidev` for the official
pi package catalog, `official` for a catalog source), and `npmPackage` names the
npm package behind a `pidev` entry; a catalog entry carries no npm package. The
provider and the npm package are recorded on the installed plugin, which is what
decides its update path (§6).

### Catalog release gate

Before publishing or diagnosing a release, run the repository preflight:

```bash
pnpm check:marketplace -- \
  --url https://raw.githubusercontent.com/vastsa/pi-desktop-plugins/main/catalog.json \
  --plugin <plugin-id>
```

The preflight is intentionally stricter than discovery. Every published
version must have a valid semantic version, a unique version within its
plugin, a 64-character SHA-256 checksum, a package URL, a positive package
size, and a permissions array. A catalog that fails this gate must be fixed in
the marketplace publisher before client update behavior is changed.

### MarketDownloadInfo
```ts
type MarketDownloadInfo = {
 pluginId: string
 version: string
 url: string
 sizeBytes: number
 shasum: string // sha256
 signature?: string // mandatory later
 signatureAlg?: "ed25519"
 publishedAt: string
}
```

## 5. Install path (marketplace)

```text
browse/search
 → detail
 → install
 → download to cache
 → verify shasum/(signature)
 → hand to local packaging installer
 → permission review
 → enable?
```

On any validation failure: abort and optionally clean up the cache.

### Download host allowlist

A v1 catalog kept every package under one known repository, so the host could
follow any redirect and rely on the checksum alone. Once package URLs describe a
publisher-influenced release, the host must also constrain *where the request
goes*, not only what comes back.

Before a marketplace package is fetched, host-core resolves the URL and rejects it
unless it satisfies all of:

1. The scheme is `https`, or `file://` for a local development catalog.
2. The URL carries no embedded credentials.
3. The host is on the allowlist below, or is the same host that served the
   catalog currently in effect.

| Host | Why |
|---|---|
| `github.com` | Release asset download entry point |
| `objects.githubusercontent.com` | Where GitHub redirects release assets |
| `release-assets.githubusercontent.com` | Current release asset origin |
| `raw.githubusercontent.com` | Catalog and repository-hosted packages |
| `codeload.github.com` | Repository archive downloads |
| `cnb.cool` | Mirror catalog and mirrored assets |

Redirects are restricted to HTTPS and re-checked: the effective URL after
redirection must satisfy the same rules as the initial URL. A custom or
enterprise catalog is trusted for its own host only — pointing the client at a
private catalog does not widen the allowlist for arbitrary third-party hosts.

An off-allowlist package URL fails with `PLUGIN_MARKET_UNTRUSTED_HOST` before any
network request is made, and the failure names the rejected host so an operator
can tell a misconfigured private source apart from a hostile catalog entry.

The host refreshes the catalog immediately before a marketplace download so
the package URL and checksum come from the same current catalog snapshot. This
prevents a short-lived UI/catalog cache from being paired with a newer package
at a mutable release URL. If the refresh is unavailable, the host may use the
last valid catalog for an offline install, but it still verifies the downloaded
bytes against that catalog checksum.

`.piplug` packages are now producible locally: `pnpm pi-plugin pack <dir>`
(equally, the `PluginPack` agent tool) writes `dist/<id>-<version>.piplug` and
prints its sha256, and the plugins page installs that file through the same
validation and permission review as a marketplace download. Distribution through
the marketplace is therefore optional — a plugin written for personal use never
has to leave the machine. See
[Plugin developer experience](10-plugin-devex.md).

A catalog entry whose plugin declares `contributes.skills` must also declare
`agent.prompt.inject` in `permissions`; without it the skills are inert and the
permission review will not mention them. `pi-plugin check` warns on that
combination.

### Official pi package install path (main process)

The host itself never downloads an npm package: it has no gzip/tar unpacker,
and its marketplace downloads are held to the distribution-host allowlist
above. A `pidev` install is performed by the desktop app's main process and only
registered through the host:

1. npm materializes the package. A staging `package.json` pins the exact
   version, lifecycle scripts stay disabled, and the registry is pinned to
   `registry.npmjs.org` through the loopback proxy the imported-extension
   pipeline already uses (ADR 0244). npm owns resolution, integrity, and the
   dependency policy.
2. The installed package directory is converted into a plugin directory by the
   same conversion as "import a pi extension": declared sources are copied under
   `src/`, the manifest declares `contributes.agentExtensions` and/or
   `contributes.skills`, `main.js` is a no-op, and sensitive files and symlinks
   are rejected. The plugin root's `package.json` is pinned to CommonJS, because
   that is the directory Node resolves `main.js` against: a package declaring
   `"type": "module"` would otherwise have that file evaluated as ESM and fail
   to load with "module is not defined in ES module scope", after the install
   had already been registered. The package keeps its own `type` in the copy
   under `src/`.
3. The result is registered through the host's existing
   `plugins.installFromPath` RPC as a normal installed plugin: source
   `marketplace`, `marketplace.providerId = "pidev"`, the npm package recorded
   as `marketplace.npmPackage`, and the trust tier recorded at install time.
4. Its dependencies are installed into the installed plugin directory
   afterwards, because the host's copy leaves `node_modules` behind.

`market.install` refuses a `pidev` id with `PLUGIN_INSTALL_UNSUPPORTED` and names
the reason, so a mistaken caller fails with a reason instead of a checksum
error. The npm pipeline is main-process only.

## 6. Update path

1. `checkUpdates` when Extensions opens or on a schedule
2. Compare installed version with latest
3. UI shows the list of available updates
4. Download and upgrade after user confirmation

Strategy:
- Installed update metadata is checked silently when Extensions opens using
  only the last valid local catalog; this cache-only check must not hold the
  host RPC state lock behind a marketplace network timeout.
- An explicit check refreshes the remote catalog and falls back to the last
  valid cache when offline.
- Optional auto-update remains per-plugin and never silently accepts a new
  permission.

### Official pi package updates

Installed pi packages take part in the normal update flow. `market.checkUpdates`
resolves their newer versions from the npm registry, they appear in the Plugins
page's update group and in `market.applyUpdates`, and applying one re-runs the
npm pipeline for that package.

- A silent check reuses the last known state and never fetches; an explicit
  check reads the registry.
- A failed lookup leaves the plugin's known state untouched: it is not evidence
  that an update went away.
- The catalog pass runs while a catalog source is selected and leaves `pidev`
  installs alone. A plugin installed from the catalog is never updated from npm,
  and one installed from npm is never updated from the catalog: the recorded
  provider and npm package decide this.

## 7. Marketplace UI information architecture

```text
Extensions
├─ Installed
│ ├─ Search + result count
│ └─ Groups: Needs attention · Updates available · Active · Turned off
├─ MCP
├─ Skills
├─ Marketplace
│ ├─ Search
│ ├─ Categories
│ └─ Card grid
├─ Detail sheet (shared by both tabs)
└─ Permission dialog (install / upgrade)
```

All five surfaces live under one segmented control that carries relevant
per-tab counts. There is no separate numeric overview band; the update alert,
tab counts, and installed group counts retain the actionable state without
duplicating it in a static card row (D196). The header keeps a single
contextual primary action (Browse marketplace / Refresh marketplace) and moves
Check for updates, Apply automatic updates, Install package, and Load local
plugin into an overflow menu (D169).

Installed rows intentionally default to a quiet two-line summary containing the
plugin name, optional local-source marker, id, and version. The state group
heading carries Active / Turned off / Updates available / Needs attention, and
load errors remain inline. Capabilities, resident service status, and
risk-tinted permission chips are rendered inside a collapsed native Details
disclosure; expanding it exposes the existing full readout without making every
row tall. Installed rows use one current-state scope trigger; opening it shows
the three scope choices with their explanations, and choosing This project
opens the existing project picker. Row icon actions remain visible at rest and
show their labels on hover and keyboard focus. This is a renderer-only
presentation choice; plugin
permissions and activation contracts are unchanged.

The Detail sheet must show:
- Permissions, grouped and labeled by risk tier
- Author
- Version (selectable version list)
- Update time
- Risk description (safety notes callout)
- Install button

The Extensions list page keeps its overview copy compact: the page header and
tab labels identify the surface, while section headers and empty states use
direct labels and actions without explanatory paragraphs. Explanations remain
where they help a decision — permission review, detail sheets, editors, and
error states.

Marketplace cards render a monogram glyph rather than fetching `iconUrl`; the
renderer performs no remote image loads (D169).

## 8. Trust model

| Level | Meaning |
|---|---|
| verified | Official or certified publisher |
| community | Community plugin |
| unknown | Custom source / uncertified |

The UI must make the trust level visible.
Community must not be disguised as verified.

Under catalog v2 the level is issued by the plugin center, not asserted by a
publisher. The client renders `unknown` for any entry whose level it cannot
attribute to the configured official source, and never promotes a level because
the catalog says so. A v1 catalog's boolean `verified` maps to `verified` /
`community` unchanged, because a v1 catalog is only writable by marketplace
maintainers.

The official pi package source reports `community` for every entry and never
`verified`: the npm registry says who published a package but cannot vouch for
it, and `verified` is only honoured from the official or mirror catalog.

## 9. Private sources (enterprise-facing)

Supports configuration:

```json
{
 "marketProviders": [
 {
 "id": "official",
 "url": "https://market.example.com"
 },
 {
 "id": "corp",
 "url": "https://plugins.company.local",
 "tokenEnv": "PI_DESKTOP_MARKET_TOKEN"
 }
 ]
}
```

## 10. Remote API draft (HTTP)

> Draft (post-MVP). Not a final implementation binding; protocol draft only.

- `GET /v1/plugins?query=&category=&page=`
- `GET /v1/plugins/:id`
- `GET /v1/plugins/:id/versions`
- `GET /v1/plugins/:id/download?version=`
- `POST /v1/updates/check`

All download metadata must include `shasum`.

## 11. Explicitly not doing (marketplace v1)

- In-app paid checkout
- Remote plugin code hot patching
- Silent auto-install
- Unverified download-and-execute
- Comment/social system (can be deferred)

## 12. Acceptance (marketplace read-only + install)

1. Can browse the plugin list
2. Can view permissions and versions
3. Can download and install
4. Cannot install if validation fails
5. Appears in Installed after install


## 12. Implementation status

Desktop Extensions page now includes a Marketplace tab that calls:

- `market.search`
- `market.getDetail`
- `market.install`
- `market.checkUpdates`
- `market.applyUpdates`

Installs always pass through checksum verification and permission review before enable.


## 13. Official marketplace repository

### Current source (catalog v1)

Repository: [vastsa/pi-desktop-plugins](https://github.com/vastsa/pi-desktop-plugins)

```text
catalog.json
packages/*.piplug
plugins/<id>/
scripts/pack_plugin.py
scripts/rebuild_catalog.py
```

Maintenance flow:

1. Edit `plugins/<id>`
2. `python3 scripts/pack_plugin.py plugins/<id>`
3. `python3 scripts/rebuild_catalog.py`
4. Commit + push to `main`
5. PI-Desktop refreshes via `market.refresh` / marketplace UI

Today a maintainer edits the source in place, packs it, and regenerates the
catalog by hand. That is what changes below; the addresses do not.

### Who writes it (catalog v2)

Repository: [vastsa/pi-plugin-center](https://github.com/vastsa/pi-plugin-center)

This repository stays the distribution source. What changes is who writes to it:
the plugin center takes over generating `catalog.json` and publishing
`packages/*.piplug`, and third-party plugin source stays in the publisher's own
repository rather than under `plugins/`.

The default catalog URL, the mirror URL, and the relative package URLs are all
unchanged, so no client release or user action is needed. Because the catalog and
packages are static files here and on the CNB Git mirror, browse, install, and
update keep working even when the center's API is unavailable.

See [15-plugin-center.md](15-plugin-center.md).

An explicit update check performs a fresh remote catalog fetch and falls back
to the last valid local catalog when offline. Opening the Extensions page also
performs a cache-only silent update check so installed rows can refresh without
making the Marketplace surface wait for a remote request. The Marketplace
header refresh action remains the explicit remote-refresh path.

Override catalog URL with env:

```text
PI_DESKTOP_PLUGIN_MARKET_URL=https://raw.githubusercontent.com/<owner>/<repo>/<ref>/catalog.json
```


## 14. Marketplace detail UX

The Extensions destination opens details as a right-side sheet (scrim + Escape + outside
click dismiss) that loads `market.getDetail` and shows:

- about text, author, and repository / homepage links (opened in the work
  panel browser, never the system browser)
- safety notes as a warning callout
- permissions grouped by risk tier, each with its plain-language explanation
- version list as selectable rows, with the picked version driving the sticky
  install / update action
- README markdown

Installing from either tab routes through the permission dialog, which groups
requests into High / Medium / Low risk sections and tags entries that are new
relative to the installed version, so an upgrade cannot silently widen access
(D169).

An official pi package is only installable from this sheet: the card says so
until the package document has been read, and the permission list shown here is
the one the conversion will declare.

Contribution docs live in the official warehouse:

- https://github.com/vastsa/pi-desktop-plugins/blob/main/CONTRIBUTING.md
- Practical template: `plugins/demo.workspace-summary`
