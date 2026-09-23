# ADR 0266: Add the official pi package catalog as a marketplace source backed by npm

- Status: Accepted
- Date: 2026-09-23
- Related: ADR 0244 (the npm dependency boundary this pipeline reuses)

## Context

The Plugins page marketplace reads catalog documents: the official GitHub
catalog, the CNB mirror, or a custom catalog URL. The official pi packages are
published somewhere else — `https://pi.dev/packages`, an npm-backed catalog
whose packages declare what the pi CLI loads through `pi.extensions`,
`pi.skills`, and `pi.prompts` in their `package.json`. Users of the pi CLI can
install those packages; PI-Desktop users could not see them at all.

The pi.dev page is server-rendered HTML with no machine-readable index, and the
host (Rust) downloads only `.piplug` files: it has no gzip/tar unpacker and its
package downloads are held to the distribution-host allowlist. Something has to
read a source that is not a catalog document, and something has to materialize
an npm package without widening the host's download boundary.

## Decision

1. **A fourth marketplace source, `pidev`.** `pluginMarketSource: "pidev"`
   selects the official pi package catalog, addressed as
   `https://pi.dev/packages`; the host reports providerId `pidev` and that
   source URL for it. `market.refresh` means "re-read the browse listing" for
   this source rather than caching a catalog document.
2. **Read the npm registry instead of the page.** Listings come from
   `https://registry.npmjs.org/-/v1/search?text=…+keywords:pi-package` (one
   page per query, 100 hits) and detail from
   `https://registry.npmjs.org/<name>`. Detail carries versions newest first
   capped at 30, readme, homepage/repository, unpacked size, published date,
   publisher, and the permissions derived from the `pi` manifest.
3. **Plugin ids encode the package name.** Unscoped `foo` becomes
   `pidev.pkg.foo`, scoped `@scope/name` becomes `pidev.scope.<scope>.<name>`,
   inside the published plugin id contract
   (`^[a-z0-9]+(\.[a-z0-9_-]+)+$`). A package name is offered only when it is
   URL- and id-safe; npm names the contract cannot represent are not offered.
4. **Permissions come from the declarations the conversion reads.**
   `pi.extensions` → `agent.extension`, `pi.skills` → `agent.prompt.inject`. A
   package that declares neither is listed but not installable, and the detail
   sheet says why. A listing entry is not installable until its package
   document has been read, so the install action lives in the detail sheet,
   which shows the real permission list before the user accepts.
5. **Trust stays `community`.** The registry says who published a package but
   cannot vouch for it, so this source never reports `verified`; `verified`
   remains reserved for the official or mirror catalog.
6. **Install through the app's npm pipeline, register as a normal plugin.** The
   main process materializes the package with npm (a staging `package.json`
   pinning the exact version, lifecycle scripts disabled, the registry pinned
   to `registry.npmjs.org` through the existing loopback proxy), converts the
   installed directory with the same conversion as "import a pi extension", and
   registers it through the host's `plugins.installFromPath` RPC with source
   `marketplace`, `marketplace.providerId = "pidev"`, the npm package recorded
   as `marketplace.npmPackage`, and the trust tier recorded at install time.
   Dependencies are installed into the installed plugin directory afterwards.
7. **The host refuses to install one itself.** `market.install` fails a `pidev`
   id with `PLUGIN_INSTALL_UNSUPPORTED` and names the reason, so a mistaken
   caller gets a reason instead of a checksum error. The npm pipeline is
   main-process only.
8. **Updates follow the recorded install.** `market.checkUpdates` resolves
   newer versions from the npm registry (a silent check reuses the last known
   state and never fetches; a failed lookup leaves that state untouched),
   `market.applyUpdates` re-runs the npm pipeline for those packages, and the
   recorded provider plus npm package decide the path: a catalog install is
   never updated from npm, and an npm install is never updated from the
   catalog.

## Consequences

- npm must exist on PATH. A missing npm fails the install with the reason the
  imported-extension dependency installer already reports, and nothing is
  registered.
- Lifecycle scripts stay disabled and the registry stays pinned, so a
  package's install scripts never run and resolution stays registry-only.
- A listing is not installable until it has been read; the card says "Open this
  plugin to install it" and the install action lives in the detail sheet.
- Trust stays `community` for every entry. The registry is a publisher record,
  not a review.
- Plugin ids encode package names, so the mapping is injective and reversible;
  names npm allows but the id contract cannot represent are simply not offered.
- One registry page per query: browsing shows the registry's own ordering and
  the search box is how a user narrows it.
- Existing sources are untouched: the official GitHub catalog, the mirror, and
  custom catalog URLs keep their URLs, checksum verification, download
  allowlist, and update path.

### Compatibility impact

Additive only. A new `pluginMarketSource` value joins the existing ones; the
market and plugin DTOs gain optional fields (`installBlocked`, `providerId`,
`npmPackage`) that older readers ignore; the `plugins.installFromPath` RPC
accepts optional `source`, `autoUpdate`, and `marketplace` params and keeps its
previous behavior when they are absent. No persisted value changes meaning and
no existing install path changes.

## Alternatives

### Scrape `https://pi.dev/packages`

Rejected. The page is server-rendered HTML with no machine-readable index: it
carries no versions, no sizes, no permissions, and no stable identifiers, so
the permission review would have nothing to show and any page redesign would
break browse, detail, and update at once. The registry behind the catalog
answers the same questions in a documented format.

### Fetch npm tarballs in the Rust host

Rejected. It would add gzip/tar dependencies to the host, require a second
download allowlist for registry hosts, and duplicate the npm resolution,
integrity, and dependency policy the app already owns in its main-process npm
pipeline (ADR 0244). The host keeps refusing a `pidev` install with
`PLUGIN_INSTALL_UNSUPPORTED` rather than growing a parallel installer.

### Treat official packages as development plugins

Rejected. A development plugin bypasses the install and permission path, is not
tracked for updates, and carries none of the installed-plugin identity the
Plugins page reads. These packages are installed software, so they are
registered as ordinary installed plugins with a recorded provider and npm
package.

## References

- `docs/spec/07-plugins/07-plugin-marketplace.md`
- `docs/spec/07-plugins/16-trusted-extensions.md` §3.2
- `docs/spec/06-delivery/04-e2e-test-plan.md`
  (`E2E-PLUGIN-pidev-market-source-reports-provider-and-url`,
  `E2E-PLUGIN-pidev-detail-reads-registry-package`,
  `E2E-PLUGIN-pidev-listing-entry-installs-only-after-detail-read`,
  `E2E-PLUGIN-pidev-prompts-only-package-is-not-installable`,
  `E2E-PLUGIN-pidev-host-refuses-package-install`)
- `docs/adr/0244-imported-extension-dependency-boundary.md`
- `crates/host-core/src/plugins/marketplace/pi_packages.rs`,
  `apps/desktop/electron/main/pi-package-install.ts`,
  `apps/desktop/electron/main/npm-installer.ts`
