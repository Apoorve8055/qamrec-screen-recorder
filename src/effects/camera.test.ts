import { describe, it, expect } from 'vitest';
import { buildCameraPath, cameraAt, viewRect } from './camera';
import type { ZoomRegion } from '../shared/types';

const opts = { transitionMs: 500, deadzone: 0.5, smoothingMs: 120 };
const none = () => null;

describe('buildCameraPath', () => {
  it('stays centered and unzoomed with no regions', () => {
    const path = buildCameraPath([], none, none, opts, 5000);
    expect(cameraAt(path, 2500)).toEqual({ scale: 1, x: 0.5, y: 0.5 });
  });

  it('frames a fixed focus, clamped so the view stays inside the frame', () => {
    const regions: ZoomRegion[] = [
      { id: 'r', start: 1000, end: 4000, scale: 2, focus: { x: 0.9, y: 0.6 }, source: 'manual' },
    ];
    const path = buildCameraPath(regions, none, none, opts, 5000);
    const cam = cameraAt(path, 2500);
    expect(cam.scale).toBeCloseTo(2);
    expect(cam.x).toBeCloseTo(0.75); // half view = 0.25, so center can't exceed 0.75
    expect(cam.y).toBeCloseTo(0.6);
    expect(cameraAt(path, 4800)).toEqual({ scale: 1, x: 0.5, y: 0.5 });
  });

  it('follows the cursor but ignores small movements inside the deadzone', () => {
    const regions: ZoomRegion[] = [{ id: 'r', start: 0, end: 10_000, scale: 2, focus: null, source: 'auto' }];
    // Cursor jiggles slightly around 0.5 -> camera should stay put
    const jiggle = (t: number) => ({ x: 0.5 + 0.05 * Math.sin(t / 100), y: 0.5 });
    const still = buildCameraPath(regions, jiggle, none, opts, 10_000);
    expect(cameraAt(still, 3000).x).toBeCloseTo(0.5, 1);

    // Cursor jumps far right -> camera pans toward it
    const jump = (t: number) => (t < 3000 ? { x: 0.5, y: 0.5 } : { x: 0.95, y: 0.5 });
    const panned = buildCameraPath(regions, jump, none, opts, 10_000);
    expect(cameraAt(panned, 2900).x).toBeCloseTo(0.5, 1);
    expect(cameraAt(panned, 5000).x).toBeGreaterThan(0.65);
  });

  it('prefers the typing focus over the cursor', () => {
    const regions: ZoomRegion[] = [{ id: 'r', start: 0, end: 5000, scale: 2, focus: null, source: 'auto' }];
    const cursor = () => ({ x: 0.3, y: 0.3 });
    const typing = () => ({ x: 0.7, y: 0.7 });
    const path = buildCameraPath(regions, cursor, typing, { ...opts, deadzone: 0 }, 5000);
    const cam = cameraAt(path, 2500);
    expect(cam.x).toBeCloseTo(0.7, 1);
    expect(cam.y).toBeCloseTo(0.7, 1);
  });
});

describe('viewRect', () => {
  it('returns the visible window', () => {
    expect(viewRect({ scale: 2, x: 0.5, y: 0.5 })).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });
});
