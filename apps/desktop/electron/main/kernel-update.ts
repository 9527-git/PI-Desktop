/**
 * Manual PI kernel update check (D467). The kernel ships inside PI-Desktop
 * releases, so this only asks the public npm registry for the newest
 * published `@earendil-works/pi-agent-core` version and compares it with the
 * bundled kernel. It never downloads or swaps a kernel.
 */
import { net } from "electron";
import {
  PI_KERNEL_VERSION,
  isNewerKernelVersion,
  parseKernelVersion,
} from "@pi-desktop/agent-runtime";
import type { KernelUpdateResult } from "@pi-desktop/shared";
import { createPublicHttpsClient } from "./public-https-fetch";

const KERNEL_REGISTRY_URL =
  "https://registry.npmjs.org/@earendil-works%2Fpi-agent-core/latest";

const client = createPublicHttpsClient({
  fetchImpl: (url, init) => net.fetch(url, init),
});

export async function checkKernelUpdate(): Promise<KernelUpdateResult> {
  const payload = (await client.request(KERNEL_REGISTRY_URL, "json")) as {
    version?: unknown;
  };
  const latestVersion =
    typeof payload?.version === "string" ? payload.version.trim() : "";
  if (!parseKernelVersion(latestVersion)) {
    throw new Error(
      `npm registry returned an unexpected kernel version: ${latestVersion || "(empty)"}`,
    );
  }
  return {
    currentVersion: PI_KERNEL_VERSION,
    latestVersion,
    updateAvailable: isNewerKernelVersion(latestVersion, PI_KERNEL_VERSION),
  };
}
