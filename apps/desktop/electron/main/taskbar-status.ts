/**
 * Native taskbar/Dock status badge (D473, repainted by D474).
 *
 * The renderer reports one aggregate snapshot; this module paints it on the
 * platform-native surface:
 *
 * - Windows: `BrowserWindow.setOverlayIcon` draws a small badge over the
 *   bottom-right corner of the taskbar button. A transparent-background
 *   bitmap is generated locally so no packaged asset can drift from the
 *   design tokens.
 * - macOS: the Dock badge is text-only, so each state gets a single glyph.
 * - Linux: no portable taskbar badge exists; the call reports unsupported.
 *
 * Colors mirror the dark-theme status tokens (`--ds-warning`, `--ds-purple`,
 * `--ds-error`, `--ds-success`) as the disc fill, with `--ds-status-ink`
 * (`--gray-900`) for both the rim and the glyph. Dark ink on a light status
 * token is the D445/D451 rule the sidebar pills already follow, and it is what
 * makes a 16px pictogram readable: white glyphs measured 2.1-2.9:1 against
 * these fills and read as a smudge at taskbar size, the ink measures 6.2-8.3:1.
 * Windows rasterizes the scale-1 representation, so the artwork is drawn full
 * bleed with chunky strokes rather than relying on a large canvas.
 */
import { app, nativeImage, type BrowserWindow, type NativeImage } from "electron";
import { catalogs, resolveLocale } from "@pi-desktop/i18n";
import {
  type TaskbarStatusKind,
  type TaskbarStatusSnapshot,
} from "@pi-desktop/shared";

type BadgeGlyph = "dots" | "exclaim" | "cross" | "check";

type BadgeDesign = {
  color: string;
  glyph: BadgeGlyph;
  dockGlyph: string;
};

/** Mirrors `--ds-status-ink` (`--gray-900`). */
const BADGE_INK = "#181818";

const BADGE_DESIGNS: Record<TaskbarStatusKind, BadgeDesign> = {
  running: { color: "#ff8549", glyph: "dots", dockGlyph: "…" },
  attention: { color: "#c27aff", glyph: "exclaim", dockGlyph: "!" },
  failed: { color: "#ff6764", glyph: "cross", dockGlyph: "✕" },
  completed: { color: "#40c977", glyph: "check", dockGlyph: "✓" },
};

export type TaskbarStatusApplication = {
  applied: boolean;
  kind: TaskbarStatusSnapshot["kind"];
  count: number;
  platform: NodeJS.Platform;
  reason?: "no-window" | "unsupported";
};

export type TaskbarStatusControllerDependencies = {
  getWindow: () => BrowserWindow | null;
  getLocale: () => string;
  platform?: NodeJS.Platform;
};

type Rgb = { r: number; g: number; b: number };

function parseHexColor(hex: string): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const nearestX = ax + t * dx;
  const nearestY = ay + t * dy;
  return Math.hypot(px - nearestX, py - nearestY);
}

/**
 * True when a point inside the disc belongs to the state glyph.
 *
 * Geometry is expressed in fractions of the badge so one definition serves the
 * 16px and 32px rasters. Every stroke is a capsule (a segment grown by half the
 * stroke width), which is what keeps the marks the same weight at any size, and
 * every mark stays clear of the rim so it never collides with the outline.
 */
function insideGlyph(
  glyph: BadgeGlyph,
  x: number,
  y: number,
  size: number,
  stroke: number,
): boolean {
  const cx = size / 2;
  const cap = stroke / 2;
  const dot = stroke * 0.55;
  if (glyph === "dots") {
    // The Dock badge's own running glyph, so both platforms say the same thing.
    for (const offset of [-0.22, 0, 0.22]) {
      if (Math.hypot(x - (cx + size * offset), y - cx) <= dot) return true;
    }
    return false;
  }
  if (glyph === "exclaim") {
    const bar = distanceToSegment(x, y, cx, size * 0.26, cx, size * 0.5) <= cap;
    const point = Math.hypot(x - cx, y - size * 0.76) <= dot;
    return bar || point;
  }
  if (glyph === "cross") {
    const first = distanceToSegment(
      x,
      y,
      size * 0.3,
      size * 0.3,
      size * 0.7,
      size * 0.7,
    );
    const second = distanceToSegment(
      x,
      y,
      size * 0.7,
      size * 0.3,
      size * 0.3,
      size * 0.7,
    );
    return Math.min(first, second) <= cap;
  }
  const first = distanceToSegment(
    x,
    y,
    size * 0.28,
    size * 0.52,
    size * 0.44,
    size * 0.68,
  );
  const second = distanceToSegment(
    x,
    y,
    size * 0.44,
    size * 0.68,
    size * 0.73,
    size * 0.32,
  );
  return Math.min(first, second) <= cap;
}

/**
 * Rasterize one status badge as a BGRA bitmap, the format
 * `nativeImage.createFromBitmap` consumes.
 *
 * The disc is full bleed and its outermost device pixel is ink, so the badge
 * keeps a defined edge on a light taskbar while the state colour carries it on
 * a dark one. Eight-fold supersampling keeps the circle, the rim and the glyph
 * smooth at taskbar size.
 */
export function createStatusBadgeBitmap(
  size: number,
  color: string,
  glyph: BadgeGlyph,
): Buffer {
  const scale = 8;
  const high = size * scale;
  const fill = parseHexColor(color);
  const ink = parseHexColor(BADGE_INK);
  const center = high / 2;
  const radius = high / 2;
  const rim = high / 16;
  const stroke = high * 0.12;
  const highPixels = new Uint8Array(high * high * 4);
  for (let y = 0; y < high; y += 1) {
    for (let x = 0; x < high; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const distance = Math.hypot(px - center, py - center);
      if (distance > radius) continue;
      const inked = distance > radius - rim || insideGlyph(glyph, px, py, high, stroke);
      const offset = (y * high + x) * 4;
      const source = inked ? ink : fill;
      highPixels[offset] = source.b;
      highPixels[offset + 1] = source.g;
      highPixels[offset + 2] = source.r;
      highPixels[offset + 3] = 255;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let alpha = 0;
      let blue = 0;
      let green = 0;
      let red = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const offset = ((y * scale + sy) * high + (x * scale + sx)) * 4;
          const pixelAlpha = highPixels[offset + 3] / 255;
          alpha += pixelAlpha;
          blue += highPixels[offset] * pixelAlpha;
          green += highPixels[offset + 1] * pixelAlpha;
          red += highPixels[offset + 2] * pixelAlpha;
        }
      }
      const outOffset = (y * size + x) * 4;
      if (alpha === 0) continue;
      out[outOffset] = Math.round(blue / alpha);
      out[outOffset + 1] = Math.round(green / alpha);
      out[outOffset + 2] = Math.round(red / alpha);
      out[outOffset + 3] = Math.round((alpha / (scale * scale)) * 255);
    }
  }
  return out;
}

export function createTaskbarStatusController({
  getWindow,
  getLocale,
  platform = process.platform,
}: TaskbarStatusControllerDependencies) {
  const imageCache = new Map<string, NativeImage>();

  function badgeImage(kind: TaskbarStatusKind): NativeImage {
    const design = BADGE_DESIGNS[kind];
    const cacheKey = `${design.color}:${design.glyph}`;
    const cached = imageCache.get(cacheKey);
    if (cached) return cached;
    const image = nativeImage.createFromBitmap(
      createStatusBadgeBitmap(16, design.color, design.glyph),
      { width: 16, height: 16, scaleFactor: 1 },
    );
    image.addRepresentation({
      scaleFactor: 2,
      width: 32,
      height: 32,
      buffer: createStatusBadgeBitmap(32, design.color, design.glyph),
    });
    imageCache.set(cacheKey, image);
    return image;
  }

  function description(kind: TaskbarStatusKind): string {
    const labels = catalogs[resolveLocale(getLocale())].taskbar;
    return labels[kind];
  }

  function clear(): TaskbarStatusApplication {
    if (platform === "win32") {
      const window = getWindow();
      if (window && !window.isDestroyed()) {
        window.setOverlayIcon(null, "");
        return { applied: true, kind: "none", count: 0, platform };
      }
      return { applied: false, kind: "none", count: 0, platform, reason: "no-window" };
    }
    if (platform === "darwin") {
      app.dock?.setBadge("");
      return { applied: true, kind: "none", count: 0, platform };
    }
    return { applied: false, kind: "none", count: 0, platform, reason: "unsupported" };
  }

  function apply(snapshot: TaskbarStatusSnapshot): TaskbarStatusApplication {
    let result: TaskbarStatusApplication;
    if (snapshot.kind === "none") {
      result = clear();
    } else if (platform === "win32") {
      const window = getWindow();
      if (!window || window.isDestroyed()) {
        result = {
          applied: false,
          kind: snapshot.kind,
          count: snapshot.count,
          platform,
          reason: "no-window",
        };
      } else {
        window.setOverlayIcon(badgeImage(snapshot.kind), description(snapshot.kind));
        result = {
          applied: true,
          kind: snapshot.kind,
          count: snapshot.count,
          platform,
        };
      }
    } else if (platform === "darwin") {
      app.dock?.setBadge(BADGE_DESIGNS[snapshot.kind].dockGlyph);
      result = {
        applied: true,
        kind: snapshot.kind,
        count: snapshot.count,
        platform,
      };
    } else {
      result = {
        applied: false,
        kind: snapshot.kind,
        count: snapshot.count,
        platform,
        reason: "unsupported",
      };
    }
    if (process.env.PI_DESKTOP_TASKBAR_PROBE === "1") {
      console.log("TASKBAR_STATUS_PROBE", JSON.stringify(result));
    }
    return result;
  }

  return { apply };
}
