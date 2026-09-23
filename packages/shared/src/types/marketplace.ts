/** Shared public types grouped by the owning application domain. */
import type {
  MarketProvenance,
  MarketReview,
  MarketTrust,
} from "./plugins.js";
import type { PluginSummary } from "./plugins.js";

export type MarketPluginSummary = {
  id: string;
  name: string;
  description: string;
  author: string;
  iconUrl?: string;
  latestVersion: string;
  downloads?: number;
  updatedAt: string;
  categories?: string[];
  permissionSummary: string[];
  verified?: boolean;
  /** Catalog v2 trust tier, as the host is willing to render it. */
  trust?: MarketTrust;
  publisherId?: string;
  installed?: boolean;
  installedVersion?: string;
  updateAvailable?: boolean;
  /** False when `latestVersion` has no published package to download yet. */
  installable?: boolean;
  /**
   * Why the install action is unavailable, when the source can explain it:
   * `not_read` while the package has not been read yet (open the plugin to
   * install it), `unsupported` when what the package declares is not something
   * this release can load. Absent means the version state decides the wording.
   */
  installBlocked?: "not_read" | "unsupported";
  /** Source that offered this entry: `official`, `mirror`, `custom`, `pidev`. */
  providerId?: string;
  /** npm package behind a `pidev` entry; absent for catalog entries. */
  npmPackage?: string;
  /** True when every catalog version of this plugin has been withdrawn. */
  yanked?: boolean;
};

export type MarketPluginDetail = MarketPluginSummary & {
  readmeMarkdown?: string;
  versions: Array<{
    version: string;
    publishedAt: string;
    changelog?: string;
    minPiDesktop?: string;
    shasum: string;
    url: string;
    sizeBytes: number;
    permissions: string[];
    /** Withdrawn: still listed in history, never offered for install. */
    yanked?: boolean;
    yankedReason?: string;
    provenance?: MarketProvenance;
    review?: MarketReview;
    signature?: string;
    signatureAlg?: string;
    keyId?: string;
  }>;
  screenshots?: string[];
  homepage?: string;
  repository?: string;
  permissions: string[];
  safetyNotes?: string;
};

export type PluginInstallResult = {
  plugin: PluginSummary;
  upgraded: boolean;
  permissionDiff: string[];
};
