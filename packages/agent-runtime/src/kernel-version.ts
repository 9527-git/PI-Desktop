/**
 * The pi agent kernel this app bundles. Both the version and the upstream
 * repository are resolved from the pinned `@earendil-works/pi-agent-core`
 * dependency at build time, so the figure shown in Settings → Info and the
 * release page Main opens can never drift from the kernel inside the sidecar
 * bundle (D467, D468).
 */
import kernelPackage from "@earendil-works/pi-agent-core/package.json" with { type: "json" };

export const PI_KERNEL_VERSION: string = kernelPackage.version;

/** Parse `major.minor.patch`; an optional `v` prefix or prerelease suffix is ignored. */
export function parseKernelVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `candidate` is a strictly newer release than `current`. */
export function isNewerKernelVersion(candidate: string, current: string): boolean {
  const next = parseKernelVersion(candidate);
  const active = parseKernelVersion(current);
  if (!next || !active) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== active[index]) return next[index] > active[index];
  }
  return false;
}

function isRecord(value: unknown): value is { url?: unknown } {
  return typeof value === "object" && value !== null;
}

/**
 * Normalize a package `repository` field (`git+https://host/owner/repo.git`,
 * `https://host/owner/repo`, or `{ url }`) to a browsable
 * `https://host/owner/repo` URL. Anything else — ssh, custom schemes, missing
 * fields — returns null so callers never hand a non-web URL to the OS.
 */
export function kernelRepositoryUrl(repository: unknown): string | null {
  const raw =
    typeof repository === "string"
      ? repository
      : isRecord(repository) && typeof repository.url === "string"
        ? repository.url
        : "";
  if (!raw.trim()) return null;
  const normalized = raw.trim().replace(/^git\+/, "").replace(/\.git$/, "");
  return /^https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+$/.test(normalized) ? normalized : null;
}

const kernelRepository = kernelRepositoryUrl(kernelPackage.repository);

/**
 * The upstream kernel's own release page. Kernel updates ship inside PI-Desktop
 * releases, so the Info row points here to explain a newer upstream version
 * instead of opening the app's own releases page. Null when the pinned
 * repository is unusable.
 */
export const PI_KERNEL_RELEASES_URL: string | null = kernelRepository
  ? `${kernelRepository}/releases/latest`
  : null;
