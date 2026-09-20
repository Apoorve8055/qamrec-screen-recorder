import type { Point, Rect, ZoomRegion } from '../shared/types';
import { zoomScaleAt } from './zoom';

/** Camera state: zoom scale and the view center in normalized source coordinates */
export interface CameraState {
  scale: number;
  x: number;
  y: number;
}

export interface CameraPath {
  hz: number;
  /** Interleaved [scale, x, y] samples */
  data: Float32Array;
}

export interface CameraOptions {
  transitionMs: number;
  /** Fraction of the half-view the cursor may move before the camera follows (0..1) */
  deadzone: number;
  /** Pan smoothing time constant, ms */
  smoothingMs: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Precomputes a smooth camera path. Pan and zoom are coupled through clamping: at scale 1
 * the view must be centered, so as the zoom eases in, the view glides toward its target.
 */
export function buildCameraPath(
  regions: ZoomRegion[],
  cursorAt: (t: number) => Point | null,
  typingFocusAt: (t: number) => Point | null,
  opts: CameraOptions,
  duration: number,
  hz = 30
): CameraPath {
  const dt = 1000 / hz;
  const n = Math.max(2, Math.ceil(duration / dt) + 1);
  const data = new Float32Array(n * 3);
  const alpha = 1 - Math.exp(-dt / Math.max(1, opts.smoothingMs));

  let cx = 0.5;
  let cy = 0.5;
  let activeId: string | null = null;

  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const { scale, region } = zoomScaleAt(regions, t, opts.transitionMs);

    if (region) {
      const half = 0.5 / region.scale;
      let desired: Point = { x: cx, y: cy };
      if (region.focus) {
        desired = region.focus;
      } else {
        const typing = typingFocusAt(t);
        const cursor = cursorAt(t);
        if (typing) {
          desired = typing;
        } else if (cursor) {
          const dz = half * opts.deadzone;
          const follow = (c: number, target: number) =>
            Math.abs(target - c) <= dz ? c : target - Math.sign(target - c) * dz;
          desired = { x: follow(cx, cursor.x), y: follow(cy, cursor.y) };
        }
      }

      if (region.id !== activeId) {
        // Entering a zoom: head straight for the target
        cx = desired.x;
        cy = desired.y;
        activeId = region.id;
      } else {
        cx += (desired.x - cx) * alpha;
        cy += (desired.y - cy) * alpha;
      }
      cx = clamp(cx, half, 1 - half);
      cy = clamp(cy, half, 1 - half);
    } else {
      activeId = null;
    }

    const viewHalf = 0.5 / scale;
    data[i * 3] = scale;
    data[i * 3 + 1] = clamp(cx, viewHalf, 1 - viewHalf);
    data[i * 3 + 2] = clamp(cy, viewHalf, 1 - viewHalf);
  }

  return { hz, data };
}

export function cameraAt(path: CameraPath, t: number): CameraState {
  const n = path.data.length / 3;
  const f = clamp((t / 1000) * path.hz, 0, n - 1);
  const i = Math.floor(f);
  const j = Math.min(n - 1, i + 1);
  const k = f - i;
  const d = path.data;
  const lerp = (a: number, b: number) => a + (b - a) * k;
  return {
    scale: lerp(d[i * 3], d[j * 3]),
    x: lerp(d[i * 3 + 1], d[j * 3 + 1]),
    y: lerp(d[i * 3 + 2], d[j * 3 + 2]),
  };
}

/** The visible part of the source frame, normalized */
export function viewRect(cam: CameraState): Rect {
  const w = 1 / cam.scale;
  return { x: cam.x - w / 2, y: cam.y - w / 2, w, h: w };
}
