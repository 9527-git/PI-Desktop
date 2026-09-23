/**
 * The pi agent kernel version this app bundles. It is resolved from the
 * pinned `@earendil-works/pi-agent-core` dependency at build time, so the
 * figure shown in Settings → Info and the comparison in Main can never
 * drift from the kernel inside the sidecar bundle (D467).
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
