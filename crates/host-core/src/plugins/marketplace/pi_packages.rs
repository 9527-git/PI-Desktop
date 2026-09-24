//! The official pi package catalog (`https://pi.dev/packages`).
//!
//! Every official pi package is an npm package whose `package.json` declares
//! what the pi CLI loads from it (`pi.extensions`, `pi.skills`, `pi.prompts`).
//! The catalog page itself is server-rendered HTML with no machine-readable
//! index, so this provider reads the same registry npm does: the search API for
//! listings and the package document for details.
//!
//! Nothing here installs anything. The desktop app materializes these packages
//! with npm — which owns the registry pin, the disabled lifecycle scripts and
//! the dependency policy — and the host records the result as an ordinary
//! installed plugin. What this module decides is what the user is offered: the
//! entries, the versions, and the permissions the install will ask for, derived
//! from the same `pi` declarations the app's conversion reads.

use super::super::*;

/// Market source URL of the official pi package catalog.
///
/// Persisted settings name this source, and the address doubles as the
/// user-facing answer to "where do these plugins come from".
pub(crate) const PI_PACKAGES_SOURCE_URL: &str = "https://pi.dev/packages";

/// Provider id reported to the client and recorded on installed plugins.
pub(crate) const PI_PACKAGES_PROVIDER_ID: &str = "pidev";

/// Registry the official catalog is published to.
const NPM_REGISTRY_URL: &str = "https://registry.npmjs.org";

/// Registry base override, mirroring `PI_DESKTOP_PLUGIN_MARKET_URL`: it lets a
/// test, a mirror, or an enterprise proxy be pointed at without touching
/// persisted settings.
const NPM_REGISTRY_ENV: &str = "PI_DESKTOP_NPM_REGISTRY_URL";

/// npm keyword every official pi package carries.
const PI_PACKAGE_KEYWORD: &str = "pi-package";

/// Prefix of the plugin id derived from a package name.
///
/// The id is the npm name behind this prefix, so the mapping back to the
/// package is exact and an installed plugin keeps the id the market listed it
/// under.
const PLUGIN_ID_PREFIX: &str = "pidev.";

/// npm caps one search page at 250 results; one browse request asks for one
/// page of this size and names its offset, so the caller pages through the
/// catalog instead of only ever seeing its first page.
///
/// The size travels back with every page: a client that has to name the page it
/// shows next needs the width of a page to turn a page number into an offset.
pub(crate) const SEARCH_PAGE_SIZE: u32 = 100;

/// Versions offered in the detail sheet, newest first.
const DETAIL_VERSION_LIMIT: usize = 30;

/// Keywords that describe the package format rather than its subject.
const FORMAT_KEYWORDS: &[&str] = &[
    "pi",
    "pi-agent",
    "pi-coding-agent",
    "pi-extension",
    "pi-package",
    "pi-plugin",
    "extension",
    "plugin",
];

const MAX_CATEGORIES: usize = 8;

/// Whether a market source URL names the official pi package catalog.
pub(crate) fn is_pi_packages_source(source_url: &str) -> bool {
    source_url
        .trim()
        .trim_end_matches('/')
        .eq_ignore_ascii_case(PI_PACKAGES_SOURCE_URL)
}

/// Plugin id of one npm package.
///
/// The published plugin id contract is a lowercase dotted id, so a scoped
/// package is encoded as `pidev.scope.<scope>.<name>` and an unscoped one as
/// `pidev.pkg.<name>`. Two packages therefore never collapse onto one plugin
/// id, and the package a plugin came from is what the id names.
pub(crate) fn plugin_id_for_package(name: &str) -> String {
    match name.strip_prefix('@').and_then(|rest| rest.split_once('/')) {
        Some((scope, rest)) => format!("{PLUGIN_ID_PREFIX}scope.{scope}.{rest}"),
        None => format!("{PLUGIN_ID_PREFIX}pkg.{name}"),
    }
}

/// npm package a plugin id was derived from, when the id belongs to this
/// provider and still names a registry-safe package.
pub(crate) fn package_from_plugin_id(plugin_id: &str) -> Option<String> {
    let rest = plugin_id.strip_prefix(PLUGIN_ID_PREFIX)?;
    let name = match rest.strip_prefix("pkg.") {
        Some(name) => name.to_string(),
        None => {
            let (scope, name) = rest.strip_prefix("scope.")?.split_once('.')?;
            format!("@{scope}/{name}")
        }
    };
    is_valid_package_name(&name).then_some(name)
}

/// Whether a string is an npm package name this provider will fetch.
///
/// Names reach both a registry URL and a plugin id, so only the lowercase
/// URL-safe registry alphabet with an optional `@scope/` is accepted. A name
/// carrying a path separator, a scheme, or a control character is refused
/// rather than encoded, which keeps a catalog entry from redirecting a request.
pub(crate) fn is_valid_package_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 214 || name.trim() != name {
        return false;
    }
    let (scope, rest) = match name.strip_prefix('@') {
        Some(rest) => match rest.split_once('/') {
            Some((scope, rest)) => (Some(scope), rest),
            None => return false,
        },
        None => (None, name),
    };
    // A dotted scope cannot be encoded into the plugin id contract without
    // making the scope and the package name indistinguishable when the id is
    // decoded again, so this provider only accepts scopes it can name.
    if scope.is_some_and(|scope| scope.contains('.')) {
        return false;
    }
    scope.is_none_or(valid_package_segment) && valid_package_segment(rest)
}

/// One npm name segment.
///
/// npm itself only forbids a leading `.` or `_`, but a name is also embedded in
/// a plugin id, whose segments must be non-empty and limited to
/// `[a-z0-9_-]`. Restricting the segment up front keeps every accepted name
/// encodable, instead of accepting one the id scheme could not represent.
fn valid_package_segment(segment: &str) -> bool {
    if segment.is_empty() || segment.len() > 214 {
        return false;
    }
    if !segment
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    {
        return false;
    }
    segment
        .chars()
        .all(|c| matches!(c, 'a'..='z' | '0'..='9' | '-' | '_' | '.'))
}

/// Whether an official pi package entry can be installed at all.
/// Why an official pi package cannot be installed, when it cannot.
///
/// The two states need different words: a search hit has simply not been read
/// yet, while a package document that declares nothing installable has been
/// read and offers nothing.
pub(crate) fn install_blocked_reason(entry: &MarketCatalogEntry) -> Option<&'static str> {
    match entry.npm_pi.as_ref() {
        // Not read yet: the install action waits for the detail sheet, which
        // reads the package document and shows what the install would ask for.
        None => Some("not_read"),
        Some(manifest) if manifest.supports_install() => None,
        Some(_) => Some("unsupported"),
    }
}

/// Whether an official pi package entry can be installed.
///
/// The `pi` manifest decides it, so only a package that has actually been read
/// and declares extensions or skills is offered for install. Offering a search
/// hit would run the consent dialog against a permission list nobody derived
/// yet, and the conversion asks for `agent.extension` and
/// `agent.prompt.inject` — permissions the user has to see before accepting.
pub(crate) fn entry_is_installable(entry: &MarketCatalogEntry) -> bool {
    entry
        .npm_pi
        .as_ref()
        .is_some_and(NpmPiManifest::supports_install)
}

/// The `pi` field of a package.json: what the pi CLI loads from a package.
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct NpmPiManifest {
    #[serde(default)]
    extensions: Value,
    #[serde(default)]
    skills: Value,
    #[serde(default)]
    prompts: Value,
}

impl NpmPiManifest {
    /// Whether the desktop app can convert this package into a plugin.
    ///
    /// Mirrors the import conversion, which turns declared extensions and
    /// skills into plugin contributions. A prompts-only package has nothing
    /// this release knows how to load.
    pub(crate) fn supports_install(&self) -> bool {
        !declared_paths(&self.extensions).is_empty() || !declared_paths(&self.skills).is_empty()
    }

    /// Permissions the conversion declares for this package.
    ///
    /// Kept identical to `generateImportedExtensionPlugin` in the desktop app:
    /// an extension runs inside the agent, a skill injects into the prompt.
    /// The consent dialog shows this set before anything is downloaded, and the
    /// host refuses the install if the conversion ends up asking for more.
    pub(crate) fn permissions(&self) -> Vec<String> {
        let mut permissions = Vec::new();
        if !declared_paths(&self.extensions).is_empty() {
            permissions.push("agent.extension".into());
        }
        if !declared_paths(&self.skills).is_empty() {
            permissions.push("agent.prompt.inject".into());
        }
        permissions
    }

    fn declares_prompts(&self) -> bool {
        !declared_paths(&self.prompts).is_empty()
    }

    /// Why this package cannot be installed, phrased for the detail sheet.
    fn unsupported_note(&self) -> String {
        if self.declares_prompts() {
            "This package declares prompts only, which PI-Desktop cannot install yet.".into()
        } else {
            "This package declares no pi extensions or skills, so there is nothing to install."
                .into()
        }
    }
}

/// Non-empty string entries of a `pi` declaration list.
///
/// The pi loader requires an array of strings, so anything else declares
/// nothing rather than being guessed at.
fn declared_paths(value: &Value) -> Vec<&str> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Registry base in effect.
fn registry_base() -> String {
    std::env::var(NPM_REGISTRY_ENV)
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| NPM_REGISTRY_URL.to_string())
}

/// Search URL for one query: an empty query browses the catalog itself.
///
/// `offset` is the number of hits the caller has already read; the registry
/// serves the page that starts there (`from`). The total the registry reports
/// is what tells the caller whether another page exists.
fn search_url(base: &str, query: Option<&str>, offset: u64) -> String {
    let text = match query.map(str::trim).filter(|query| !query.is_empty()) {
        Some(query) => format!("{query} keywords:{PI_PACKAGE_KEYWORD}"),
        None => format!("keywords:{PI_PACKAGE_KEYWORD}"),
    };
    let mut url = format!(
        "{base}/-/v1/search?text={}&size={SEARCH_PAGE_SIZE}",
        encode_query(&text)
    );
    if offset > 0 {
        url.push_str(&format!("&from={offset}"));
    }
    url
}

/// Where the next page starts, when the registry has one.
///
/// The cursor advances by the hits this page *consumed*, not by the entries the
/// caller kept: a hit the id contract cannot encode still occupied a slot, and
/// counting it as read is what keeps paging from returning it forever.
pub(crate) fn next_page_offset(offset: u64, consumed: usize, total: u64) -> Option<u64> {
    if consumed == 0 {
        return None;
    }
    let next = offset.saturating_add(consumed as u64);
    (next < total).then_some(next)
}

/// Percent-encode a query parameter value.
///
/// The whole search text travels in one parameter, so spaces and qualifier
/// punctuation have to survive the round trip.
fn encode_query(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// Fetch and parse one registry document.
fn fetch_json(url: &str) -> Result<Value> {
    let bytes = download_url(url)
        .map_err(|e| anyhow!("PLUGIN_NETWORK: npm registry request failed: {e}"))?;
    let raw = String::from_utf8(bytes)
        .map_err(|_| anyhow!("PLUGIN_MARKET_INVALID: registry response is not utf8"))?;
    serde_json::from_str(&raw)
        .map_err(|e| anyhow!("PLUGIN_MARKET_INVALID: registry response is not json: {e}"))
}

/// One page of the official catalog, plus where the next page starts.
///
/// The registry reports the size of the whole match set; the search box is one
/// way to narrow 10k packages, and the offset is the other, so a browse request
/// still stays a single round trip.
pub(crate) fn search_entries(
    query: Option<&str>,
    offset: u64,
) -> Result<(Vec<MarketCatalogEntry>, u64, Option<u64>)> {
    let value = fetch_json(&search_url(&registry_base(), query, offset))?;
    let objects = value
        .get("objects")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("PLUGIN_MARKET_INVALID: registry search response has no results"))?;
    // A registry that omits `total` still answers the page: the caller then
    // treats this page as the last one rather than inventing a count.
    let total = value
        .get("total")
        .and_then(Value::as_u64)
        .unwrap_or(objects.len() as u64);
    let entries: Vec<MarketCatalogEntry> =
        objects.iter().filter_map(entry_from_search_item).collect();
    let next = next_page_offset(offset, objects.len(), total);
    Ok((entries, total, next))
}

/// Read one package document into a catalog entry.
pub(crate) fn package_entry(plugin_id: &str) -> Result<MarketCatalogEntry> {
    let package = package_from_plugin_id(plugin_id)
        .ok_or_else(|| anyhow!("PLUGIN_NOT_FOUND: {plugin_id}"))?;
    package_entry_for(&package, plugin_id)
}

/// Read one package document for an id whose package name is already known.
///
/// An update resolves the package the install recorded rather than one derived
/// again from the id, so a change to the id mapping cannot retarget a plugin.
pub(crate) fn package_entry_for(package: &str, plugin_id: &str) -> Result<MarketCatalogEntry> {
    if !is_valid_package_name(package) || plugin_id_for_package(package) != plugin_id {
        bail!("PLUGIN_NOT_FOUND: {plugin_id}");
    }
    let value = fetch_json(&format!("{}/{}", registry_base(), package))?;
    entry_from_package_document(&value, plugin_id)
}

/// Map one search hit.
///
/// A hit carries the latest version but neither the package contents nor a
/// checksum, so the entry is enough to browse and to open a detail sheet from,
/// and nothing more.
fn entry_from_search_item(item: &Value) -> Option<MarketCatalogEntry> {
    let package = item.get("package")?;
    let name = string_field(package, "name")?;
    if !is_valid_package_name(&name) {
        return None;
    }
    let version = string_field(package, "version")?;
    let links = package.get("links");
    let publisher = search_publisher(package);
    let published_at = string_field(package, "date").unwrap_or_else(|| Utc::now().to_rfc3339());
    Some(MarketCatalogEntry {
        id: plugin_id_for_package(&name),
        name,
        description: string_field(package, "description").unwrap_or_default(),
        author: publisher.clone().unwrap_or_default(),
        icon_url: None,
        categories: categories_from_keywords(package.get("keywords")),
        // The registry says who published a package; it cannot vouch for it.
        verified: false,
        trust: Some("community".into()),
        publisher_id: publisher,
        downloads: item
            .get("downloads")
            .and_then(|downloads| downloads.get("monthly"))
            .and_then(Value::as_u64),
        homepage: links.and_then(|links| string_field(links, "homepage")),
        repository: links
            .and_then(|links| string_field(links, "repository"))
            .map(|repository| normalize_repository(&repository)),
        readme_markdown: None,
        safety_notes: None,
        versions: vec![MarketVersion {
            version,
            published_at,
            ..Default::default()
        }],
        npm_pi: None,
    })
}

/// Map one package document.
fn entry_from_package_document(value: &Value, plugin_id: &str) -> Result<MarketCatalogEntry> {
    let name = string_field(value, "name")
        .ok_or_else(|| anyhow!("PLUGIN_MARKET_INVALID: package document has no name"))?;
    if plugin_id_for_package(&name) != plugin_id {
        bail!("PLUGIN_NOT_FOUND: {plugin_id}");
    }
    let versions_map = value.get("versions").and_then(Value::as_object);
    let times = value.get("time");
    let latest = value
        .get("dist-tags")
        .and_then(|tags| string_field(tags, "latest"));
    let mut versions: Vec<MarketVersion> = versions_map
        .into_iter()
        .flatten()
        .filter_map(|(version, document)| version_from_document(version, document, times))
        .collect();
    versions.sort_by(|a, b| compare_plugin_versions(&b.version, &a.version));
    versions.truncate(DETAIL_VERSION_LIMIT);
    let pi = latest
        .as_deref()
        .and_then(|latest| versions_map.and_then(|map| map.get(latest)))
        .and_then(pi_manifest);
    // Only a package that declares contributions the app can convert is
    // offered for install. Blanking the package metadata is what disables the
    // install action; the note explains why in the sheet, so the user is not
    // left with a button that fails after consent.
    let supported = pi
        .as_ref()
        .map(NpmPiManifest::supports_install)
        .unwrap_or(false);
    if !supported {
        for version in versions.iter_mut() {
            version.url.clear();
            version.shasum.clear();
        }
    }
    let publisher = document_publisher(value);
    Ok(MarketCatalogEntry {
        id: plugin_id.to_string(),
        name,
        description: string_field(value, "description").unwrap_or_default(),
        author: publisher.clone().unwrap_or_default(),
        icon_url: None,
        categories: categories_from_keywords(value.get("keywords")),
        verified: false,
        trust: Some("community".into()),
        publisher_id: publisher,
        downloads: None,
        homepage: string_field(value, "homepage"),
        repository: string_field(value, "repository")
            .map(|repository| normalize_repository(&repository)),
        readme_markdown: string_field(value, "readme"),
        safety_notes: match (supported, pi.as_ref()) {
            (false, Some(manifest)) => Some(manifest.unsupported_note()),
            (false, None) => Some(NpmPiManifest::default().unsupported_note()),
            (true, _) => None,
        },
        versions,
        npm_pi: pi,
    })
}

/// Map one version document.
///
/// A version without a tarball is not installable and is left out entirely
/// rather than offered as a version that can only fail.
fn version_from_document(
    version: &str,
    document: &Value,
    times: Option<&Value>,
) -> Option<MarketVersion> {
    let dist = document.get("dist")?;
    let url = string_field(dist, "tarball")?;
    let pi = pi_manifest(document);
    Some(MarketVersion {
        version: version.to_string(),
        published_at: times
            .and_then(|times| string_field(times, version))
            .unwrap_or_default(),
        shasum: string_field(dist, "shasum").unwrap_or_default(),
        url,
        size_bytes: dist
            .get("unpackedSize")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        permissions: pi
            .as_ref()
            .map(NpmPiManifest::permissions)
            .unwrap_or_default(),
        ..Default::default()
    })
}

/// The `pi` manifest of one package or version document.
fn pi_manifest(document: &Value) -> Option<NpmPiManifest> {
    document
        .get("pi")
        .filter(|pi| pi.is_object())
        .and_then(|pi| serde_json::from_value::<NpmPiManifest>(pi.clone()).ok())
}

/// Publisher username of a search hit.
fn search_publisher(package: &Value) -> Option<String> {
    package
        .get("publisher")
        .and_then(|publisher| string_field(publisher, "username"))
        .or_else(|| first_maintainer(package))
}

/// Publisher username of a package document: npm reports `author` as a string
/// or an object, and maintainers when it does not.
fn document_publisher(value: &Value) -> Option<String> {
    match value.get("author") {
        Some(Value::String(name)) => Some(name.trim().to_string()).filter(|name| !name.is_empty()),
        Some(author) => string_field(author, "name"),
        None => None,
    }
    .or_else(|| first_maintainer(value))
}

fn first_maintainer(value: &Value) -> Option<String> {
    value
        .get("maintainers")
        .and_then(Value::as_array)
        .and_then(|maintainers| maintainers.first())
        .and_then(|maintainer| string_field(maintainer, "username"))
}

/// Keywords that describe the subject of a package.
///
/// The category filter is built from these, so the format keywords every pi
/// package carries are dropped instead of turning into one useless category.
fn categories_from_keywords(keywords: Option<&Value>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for keyword in keywords
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        let keyword = keyword.trim().to_ascii_lowercase();
        if keyword.is_empty()
            || FORMAT_KEYWORDS.contains(&keyword.as_str())
            || out.iter().any(|existing| existing == &keyword)
        {
            continue;
        }
        out.push(keyword);
        if out.len() == MAX_CATEGORIES {
            break;
        }
    }
    out.sort();
    out
}

/// Strip the npm `git+` prefix and any `.git` suffix so the sheet opens a
/// repository link that resolves.
fn normalize_repository(raw: &str) -> String {
    let trimmed = raw.trim().trim_start_matches("git+").trim_end_matches('/');
    trimmed.strip_suffix(".git").unwrap_or(trimmed).to_string()
}

/// Trimmed non-empty string field.
fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn search_hit() -> Value {
        json!({
            "downloads": { "monthly": 429774, "weekly": 85225 },
            "updated": "2026-09-22T12:20:26.246Z",
            "package": {
                "name": "pi-web-access",
                "keywords": ["pi-package", "pi", "extension", "web-search", "scraping"],
                "version": "0.30.0",
                "description": "Web search for the Pi coding agent.",
                "publisher": { "username": "nicopreme" },
                "date": "2026-09-19T14:25:30.716Z",
                "links": {
                    "homepage": "https://github.com/nicobailon/pi-web-access#readme",
                    "repository": "git+https://github.com/nicobailon/pi-web-access.git",
                    "npm": "https://www.npmjs.com/package/pi-web-access"
                }
            }
        })
    }

    fn package_document() -> Value {
        json!({
            "name": "@narumitw/pi-plan-mode",
            "dist-tags": { "latest": "0.58.3" },
            "license": "MIT",
            "readme": "# Plan mode\n\nRead-only collaboration mode.",
            "author": { "name": "narumitw" },
            "time": {
                "created": "2026-01-02T00:00:00.000Z",
                "0.58.2": "2026-08-01T00:00:00.000Z",
                "0.58.3": "2026-09-01T00:00:00.000Z"
            },
            "versions": {
                "0.58.2": {
                    "version": "0.58.2",
                    "pi": { "extensions": ["./dist/index.ts"] },
                    "dist": {
                        "shasum": "aaaa",
                        "tarball": "https://registry.npmjs.org/@narumitw/pi-plan-mode/-/pi-plan-mode-0.58.2.tgz",
                        "unpackedSize": 900000
                    }
                },
                "0.58.3": {
                    "version": "0.58.3",
                    "pi": { "extensions": ["./dist/index.ts"] },
                    "dist": {
                        "shasum": "bbbb",
                        "tarball": "https://registry.npmjs.org/@narumitw/pi-plan-mode/-/pi-plan-mode-0.58.3.tgz",
                        "unpackedSize": 946146
                    }
                }
            }
        })
    }

    #[test]
    fn package_names_must_be_registry_safe() {
        assert!(is_valid_package_name("bigpowers"));
        assert!(is_valid_package_name("@narumitw/pi-plan-mode"));
        assert!(is_valid_package_name("pi.thing_2"));
        // Anything that would change the meaning of the URL or the id.
        assert!(!is_valid_package_name("@narumitw"));
        assert!(!is_valid_package_name("a/b"));
        assert!(!is_valid_package_name("PI-Web-Access"));
        assert!(!is_valid_package_name("https://evil.example/pkg"));
        assert!(!is_valid_package_name("../../etc/passwd"));
        assert!(!is_valid_package_name(".hidden"));
        assert!(!is_valid_package_name(""));
        // npm allows these, but neither can be represented as a plugin id
        // segment, so accepting them would mean accepting what cannot be named.
        assert!(!is_valid_package_name("-leading"));
        assert!(!is_valid_package_name("has~tilde"));
        assert!(!is_valid_package_name("_leading"));
    }

    #[test]
    fn plugin_ids_are_dotted_ids_that_round_trip_to_the_package() {
        for (name, id) in [
            ("bigpowers", "pidev.pkg.bigpowers"),
            ("pi.thing_2", "pidev.pkg.pi.thing_2"),
            (
                "@narumitw/pi-plan-mode",
                "pidev.scope.narumitw.pi-plan-mode",
            ),
        ] {
            assert_eq!(plugin_id_for_package(name), id, "{name}");
            assert_eq!(package_from_plugin_id(id).as_deref(), Some(name));
        }
        // Another provider's plugin is never mistaken for a package, and neither
        // is a half-written id.
        assert_eq!(package_from_plugin_id("imported.thing"), None);
        assert_eq!(package_from_plugin_id("pidev."), None);
        assert_eq!(package_from_plugin_id("pidev.pkg."), None);
        assert_eq!(package_from_plugin_id("pidev.pkg.a/b"), None);
        assert_eq!(package_from_plugin_id("pidev.scope.narumitw"), None);
        assert_eq!(package_from_plugin_id("pidev.other.tool"), None);
        // A dotted scope has no lossless encoding, so it is refused up front
        // rather than decoded into the wrong package name: this id, built from
        // `@my.scope/tool`, comes back as a different package.
        assert!(!is_valid_package_name("@my.scope/tool"));
        assert_eq!(
            package_from_plugin_id("pidev.scope.my.scope.tool").as_deref(),
            Some("@my/scope.tool")
        );
    }

    /// The id contract the plugin manifest schema publishes.
    const PLUGIN_ID_PATTERN: &str = r"^[a-z0-9]+(\.[a-z0-9_-]+)+$";

    #[test]
    fn every_encoded_id_satisfies_the_published_plugin_id_contract() {
        let pattern = regex::Regex::new(PLUGIN_ID_PATTERN).unwrap();
        for name in ["bigpowers", "pi.thing_2", "@narumitw/pi-plan-mode"] {
            let id = plugin_id_for_package(name);
            assert!(pattern.is_match(&id), "{id} must match {PLUGIN_ID_PATTERN}");
            assert_eq!(id.len(), id.trim().len());
            assert!(!id.contains('@') && !id.contains('/'));
        }
    }

    #[test]
    fn the_search_query_keeps_the_official_keyword() {
        assert_eq!(
            search_url("https://registry.npmjs.org", None, 0),
            "https://registry.npmjs.org/-/v1/search?text=keywords%3Api-package&size=100"
        );
        assert_eq!(
            search_url("https://registry.npmjs.org", Some("  plan mode "), 0),
            "https://registry.npmjs.org/-/v1/search?text=plan+mode+keywords%3Api-package&size=100"
        );
    }

    #[test]
    fn a_later_page_names_its_offset_and_the_first_page_stays_bare() {
        assert_eq!(
            search_url("https://registry.npmjs.org", None, 100),
            "https://registry.npmjs.org/-/v1/search?text=keywords%3Api-package&size=100&from=100"
        );
        assert_eq!(
            search_url("https://registry.npmjs.org", Some("plan mode"), 250),
            "https://registry.npmjs.org/-/v1/search?text=plan+mode+keywords%3Api-package&size=100&from=250"
        );
    }

    #[test]
    fn the_cursor_advances_by_consumed_hits_and_stops_at_the_total() {
        // A full page of a larger set: the next page starts after it.
        assert_eq!(next_page_offset(0, 100, 10_553), Some(100));
        // The hits a page consumed include ones the id contract dropped, so the
        // cursor advances by what the page read, not by what it kept -- the
        // dropped hits would otherwise come back on every page.
        assert_eq!(next_page_offset(100, 100, 10_553), Some(200));
        // The last page: nothing left past it.
        assert_eq!(next_page_offset(10_500, 53, 10_553), None);
        assert_eq!(next_page_offset(0, 100, 100), None);
        // An empty page cannot be paged past, whatever the total claims.
        assert_eq!(next_page_offset(0, 0, 10_553), None);
        assert_eq!(next_page_offset(200, 0, 10_553), None);
    }

    #[test]
    fn search_hits_map_to_browsable_entries() {
        let entry = entry_from_search_item(&search_hit()).expect("hit maps");
        assert_eq!(entry.id, "pidev.pkg.pi-web-access");
        assert_eq!(entry.name, "pi-web-access");
        assert_eq!(entry.author, "nicopreme");
        assert_eq!(entry.publisher_id.as_deref(), Some("nicopreme"));
        assert_eq!(entry.downloads, Some(429774));
        assert_eq!(entry.versions.len(), 1);
        assert_eq!(entry.versions[0].version, "0.30.0");
        // Format keywords are not categories.
        assert_eq!(entry.categories, vec!["scraping", "web-search"]);
        assert_eq!(
            entry.repository.as_deref(),
            Some("https://github.com/nicobailon/pi-web-access")
        );
        // A search hit carries no `pi` manifest, so the install action waits for
        // the detail sheet rather than consenting to permissions nobody derived.
        assert!(!entry_is_installable(&entry));
        assert_eq!(install_blocked_reason(&entry), Some("not_read"));
    }

    #[test]
    fn package_documents_map_to_versions_and_permissions() {
        let id = plugin_id_for_package("@narumitw/pi-plan-mode");
        let entry = entry_from_package_document(&package_document(), &id).expect("document maps");
        assert_eq!(entry.id, id);
        assert_eq!(entry.author, "narumitw");
        assert_eq!(
            entry.readme_markdown.as_deref(),
            Some("# Plan mode\n\nRead-only collaboration mode.")
        );
        // Newest first.
        assert_eq!(
            entry
                .versions
                .iter()
                .map(|version| version.version.as_str())
                .collect::<Vec<_>>(),
            vec!["0.58.3", "0.58.2"]
        );
        let latest = &entry.versions[0];
        assert_eq!(latest.published_at, "2026-09-01T00:00:00.000Z");
        assert_eq!(latest.size_bytes, 946146);
        assert_eq!(
            latest.url,
            "https://registry.npmjs.org/@narumitw/pi-plan-mode/-/pi-plan-mode-0.58.3.tgz"
        );
        // The manifest decides both installability and the consent list.
        assert_eq!(latest.permissions, vec!["agent.extension"]);
        assert!(entry_is_installable(&entry));
        assert_eq!(entry.safety_notes, None);
    }

    #[test]
    fn a_package_without_declared_contributions_is_not_installable() {
        let mut document = package_document();
        document["versions"]["0.58.3"]["pi"] = json!({ "prompts": ["./prompts"] });
        let id = plugin_id_for_package("@narumitw/pi-plan-mode");
        let entry = entry_from_package_document(&document, &id).expect("document maps");
        assert!(!entry_is_installable(&entry));
        assert_eq!(install_blocked_reason(&entry), Some("unsupported"));
        // The install action is disabled by the missing package metadata, and
        // the note says why rather than leaving a button that fails later.
        assert!(entry.versions.iter().all(|version| version.url.is_empty()));
        assert!(entry
            .versions
            .iter()
            .all(|version| version.shasum.is_empty()));
        assert!(
            entry
                .safety_notes
                .as_deref()
                .unwrap_or_default()
                .contains("prompts only"),
            "{:?}",
            entry.safety_notes
        );
    }

    #[test]
    fn a_version_without_a_package_is_left_out() {
        let mut document = package_document();
        document["versions"]["0.58.3"]["dist"] = json!({ "shasum": "bbbb" });
        let id = plugin_id_for_package("@narumitw/pi-plan-mode");
        let entry = entry_from_package_document(&document, &id).expect("document maps");
        assert_eq!(
            entry
                .versions
                .iter()
                .map(|version| version.version.as_str())
                .collect::<Vec<_>>(),
            vec!["0.58.2"]
        );
    }

    #[test]
    fn a_document_for_another_package_is_refused() {
        let err = entry_from_package_document(&package_document(), "pidev.other").unwrap_err();
        assert!(err.to_string().contains("PLUGIN_NOT_FOUND"), "{err}");
    }
}
