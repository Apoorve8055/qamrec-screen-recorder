import type { CaptureSurface, Point, Rect, ViewportInfo } from '../shared/types';

/**
 * Maps page (viewport CSS px) coordinates into normalized coordinates of the captured frame.
 * Window/monitor mapping estimates the browser chrome from outer vs inner window size.
 */

function chromeInsets(vp: ViewportInfo) {
  const side = Math.max(0, (vp.outerWidth - vp.innerWidth) / 2);
  const top = Math.max(0, vp.outerHeight - vp.innerHeight - side);
  return { side, top };
}

export function mapViewportPoint(p: Point, vp: ViewportInfo, surface: CaptureSurface): Point {
  switch (surface) {
    case 'window': {
      const { side, top } = chromeInsets(vp);
      return { x: (side + p.x) / vp.outerWidth, y: (top + p.y) / vp.outerHeight };
    }
    case 'monitor': {
      const { side, top } = chromeInsets(vp);
      return {
        x: (vp.screenX - vp.screenLeft + side + p.x) / vp.screenWidth,
        y: (vp.screenY - vp.screenTop + top + p.y) / vp.screenHeight,
      };
    }
    default:
      return { x: p.x / vp.innerWidth, y: p.y / vp.innerHeight };
  }
}

export function mapViewportRect(r: Rect, vp: ViewportInfo, surface: CaptureSurface): Rect {
  const a = mapViewportPoint({ x: r.x, y: r.y }, vp, surface);
  const b = mapViewportPoint({ x: r.x + r.w, y: r.y + r.h }, vp, surface);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/**
 * Whether the tracked page plausibly is what's being captured, judged by aspect ratio.
 * When the user picks some other window or tab, pointer effects must not be applied.
 */
export function mappingIsPlausible(
  vp: ViewportInfo,
  surface: CaptureSurface,
  captureWidth: number,
  captureHeight: number,
  tolerance = 0.04
): boolean {
  let expected: number;
  switch (surface) {
    case 'tab':
    case 'browser':
      expected = vp.innerWidth / vp.innerHeight;
      break;
    case 'window':
      expected = vp.outerWidth / vp.outerHeight;
      break;
    case 'monitor':
      expected = vp.screenWidth / vp.screenHeight;
      break;
    default:
      return false;
  }
  const actual = captureWidth / captureHeight;
  return Math.abs(actual - expected) / expected <= tolerance;
}
