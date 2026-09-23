import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PI_KERNEL_RELEASES_URL,
  PI_KERNEL_VERSION,
  isNewerKernelVersion,
  kernelRepositoryUrl,
  parseKernelVersion,
} from "./kernel-version.js";

describe("kernel version", () => {
  it("matches the pinned pi-agent-core dependency", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(PI_KERNEL_VERSION).toBe(
      manifest.dependencies["@earendil-works/pi-agent-core"],
    );
  });

  it("parses dotted release versions and rejects anything else", () => {
    expect(parseKernelVersion("0.87.0")).toEqual([0, 87, 0]);
    expect(parseKernelVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseKernelVersion("0.87.0-beta.1")).toEqual([0, 87, 0]);
    expect(parseKernelVersion("0.87")).toBeNull();
    expect(parseKernelVersion("latest")).toBeNull();
  });

  it("compares releases part by part", () => {
    expect(isNewerKernelVersion("0.87.1", "0.87.0")).toBe(true);
    expect(isNewerKernelVersion("0.88.0", "0.87.9")).toBe(true);
    expect(isNewerKernelVersion("1.0.0", "0.99.99")).toBe(true);
    expect(isNewerKernelVersion("0.87.0", "0.87.0")).toBe(false);
    expect(isNewerKernelVersion("0.86.9", "0.87.0")).toBe(false);
    expect(isNewerKernelVersion("0.87.0-beta.1", "0.87.0")).toBe(false);
  });

  it("treats an unparsable version as not newer", () => {
    expect(isNewerKernelVersion("next", "0.87.0")).toBe(false);
    expect(isNewerKernelVersion("0.87.1", "unreleased")).toBe(false);
  });

  it("normalizes a package repository field to a browsable URL", () => {
    expect(
      kernelRepositoryUrl({ url: "git+https://github.com/earendil-works/pi.git" }),
    ).toBe("https://github.com/earendil-works/pi");
    expect(kernelRepositoryUrl("https://gitlab.com/acme/kernel")).toBe(
      "https://gitlab.com/acme/kernel",
    );
    expect(
      kernelRepositoryUrl({ url: "git+ssh://git@github.com/acme/kernel.git" }),
    ).toBeNull();
    expect(kernelRepositoryUrl({ directory: "packages/agent" })).toBeNull();
    expect(kernelRepositoryUrl(undefined)).toBeNull();
  });

  it("points the release action at the kernel's own repository", () => {
    const installed = JSON.parse(
      readFileSync(
        new URL(
          "../node_modules/@earendil-works/pi-agent-core/package.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { repository?: unknown };
    const repository = kernelRepositoryUrl(installed.repository);
    expect(repository).toBe("https://github.com/earendil-works/pi");
    expect(PI_KERNEL_RELEASES_URL).toBe(`${repository}/releases/latest`);
  });
});
