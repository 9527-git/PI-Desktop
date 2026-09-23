import { describe, expect, it } from "vitest";
import {
  isValidPiPackageName,
  piDeclaredPaths,
  piManifestPermissions,
  piManifestSupportsInstall,
  piPackageFromPluginId,
  piPackageInstallSpec,
  piPluginIdForPackage,
  PI_PACKAGE_ID_PREFIX,
} from "./pi-package.js";

/** The published plugin id contract (07-plugins/02-plugin-manifest-schema.md). */
const PLUGIN_ID = /^[a-z0-9]+(\.[a-z0-9_-]+)+$/;

describe("isValidPiPackageName", () => {
  it("accepts registry names the plugin id can name back", () => {
    for (const name of ["bigpowers", "@narumitw/pi-plan-mode", "pi.thing_2", "a"]) {
      expect(isValidPiPackageName(name), name).toBe(true);
    }
  });

  it("refuses names npm allows but the id contract cannot represent", () => {
    for (const name of [
      "-leading",
      "_leading",
      ".hidden",
      "has~tilde",
      "@my.scope/tool",
      "@scope",
      "a/b",
      "PI-Web-Access",
      "https://evil.example/pkg",
      "../../etc/passwd",
      " padded",
      "",
    ]) {
      expect(isValidPiPackageName(name), name).toBe(false);
    }
  });
});

describe("plugin id mapping", () => {
  it("encodes both package shapes as dotted plugin ids", () => {
    expect(piPluginIdForPackage("bigpowers")).toBe("pidev.pkg.bigpowers");
    expect(piPluginIdForPackage("pi.thing_2")).toBe("pidev.pkg.pi.thing_2");
    expect(piPluginIdForPackage("@narumitw/pi-plan-mode")).toBe(
      "pidev.scope.narumitw.pi-plan-mode",
    );
  });

  it("satisfies the published plugin id contract", () => {
    for (const name of ["bigpowers", "pi.thing_2", "@narumitw/pi-plan-mode"]) {
      const id = piPluginIdForPackage(name);
      expect(PLUGIN_ID.test(id), id).toBe(true);
      expect(id.startsWith(PI_PACKAGE_ID_PREFIX)).toBe(true);
    }
  });

  it("round trips every accepted package name", () => {
    for (const name of ["bigpowers", "pi.thing_2", "@narumitw/pi-plan-mode", "a"]) {
      expect(piPackageFromPluginId(piPluginIdForPackage(name))).toBe(name);
    }
  });

  it("answers null for anything that is not an official pi package id", () => {
    for (const id of [
      "imported.thing",
      "pidev.",
      "pidev.pkg.",
      "pidev.pkg.a/b",
      "pidev.scope.narumitw",
      "pidev.other.tool",
      "",
    ]) {
      expect(piPackageFromPluginId(id), id).toBeNull();
    }
  });
});

describe("piPackageInstallSpec", () => {
  it("pins a version when one is given and asks for latest when it is not", () => {
    expect(piPackageInstallSpec("pi-web-access", "0.30.0")).toBe("pi-web-access@0.30.0");
    expect(piPackageInstallSpec("@narumitw/pi-plan-mode", " 0.58.3 ")).toBe(
      "@narumitw/pi-plan-mode@0.58.3",
    );
    expect(piPackageInstallSpec("pi-web-access")).toBe("pi-web-access");
    expect(piPackageInstallSpec("pi-web-access", "  ")).toBe("pi-web-access");
  });
});

describe("pi manifest", () => {
  it("reads declared paths from the arrays the pi loader accepts", () => {
    expect(piDeclaredPaths(["./dist/index.ts", " ", 3, null])).toEqual(["./dist/index.ts"]);
    expect(piDeclaredPaths("./dist/index.ts")).toEqual([]);
    expect(piDeclaredPaths(undefined)).toEqual([]);
  });

  it("installs only what the conversion can turn into contributions", () => {
    expect(piManifestSupportsInstall({ extensions: ["./dist/index.ts"] })).toBe(true);
    expect(piManifestSupportsInstall({ skills: ["./.pi/skills"] })).toBe(true);
    expect(piManifestSupportsInstall({ extensions: [] })).toBe(false);
    expect(piManifestSupportsInstall({ prompts: ["./prompts"] })).toBe(false);
    expect(piManifestSupportsInstall(undefined)).toBe(false);
  });

  it("derives the same permissions the conversion declares", () => {
    expect(piManifestPermissions({ extensions: ["./a.ts"] })).toEqual(["agent.extension"]);
    expect(piManifestPermissions({ skills: ["./.pi/skills"] })).toEqual([
      "agent.prompt.inject",
    ]);
    expect(
      piManifestPermissions({ extensions: ["./a.ts"], skills: ["./.pi/skills"] }),
    ).toEqual(["agent.extension", "agent.prompt.inject"]);
    expect(piManifestPermissions({ prompts: ["./prompts"] })).toEqual([]);
    expect(piManifestPermissions(undefined)).toEqual([]);
  });
});
