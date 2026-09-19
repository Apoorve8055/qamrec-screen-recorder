import { describe, it, expect } from 'vitest';
import {
  buildAutoZoomRegions,
  buildMotionZoomRegions,
  combineZoomRegions,
  zoomScaleAt,
} from './zoom';
import type { TimelineEvent, ZoomRegion, ZoomSettings } from '../shared/types';

const settings: ZoomSettings = {
  auto: true,
  intensity: 2,
  duration: 2000,
  transitionMs: 500,
  followCursor: true,
  typingFocus: true,
};

const click = (t: number, x = 0.5, y = 0.5): TimelineEvent => ({ t, type: 'click', x, y });

describe('buildAutoZoomRegions', () => {
  it('returns nothing when auto zoom is off', () => {
    expect(buildAutoZoomRegions([click(1000)], { ...settings, auto: false }, 10_000)).toEqual([]);
  });

  it('zooms in so the zoom is fully in by the time of the click', () => {
    const [r] = buildAutoZoomRegions([click(3000)], settings, 10_000);
    expect(r.start).toBe(2500);
    expect(r.end).toBe(5000);
    expect(r.scale).toBe(2);
    expect(r.source).toBe('auto');
    expect(r.focus).toBeNull(); // follows the cursor
  });

  it('merges clicks close together into one region', () => {
    const regions = buildAutoZoomRegions([click(1000), click(2500), click(4000)], settings, 20_000);
    expect(regions).toHaveLength(1);
    expect(regions[0].start).toBe(500);
    expect(regions[0].end).toBe(6000);
  });

  it('keeps clicks far apart as separate regions', () => {
    const regions = buildAutoZoomRegions([click(1000), click(10_000)], settings, 20_000);
    expect(regions).toHaveLength(2);
  });

  it('uses fixed focus on the click when not following the cursor', () => {
    const [r] = buildAutoZoomRegions([click(1000, 0.2, 0.3)], { ...settings, followCursor: false }, 10_000);
    expect(r.focus).toEqual({ x: 0.2, y: 0.3 });
  });

  it('ends a zoom when the user scrolls', () => {
    const [r] = buildAutoZoomRegions([click(1000), { t: 1800, type: 'scroll', dy: 300 }], settings, 10_000);
    expect(r.end).toBe(1800);
  });

  it('frames the focused element while typing', () => {
    const rect = { x: 0.1, y: 0.4, w: 0.2, h: 0.05 };
    const events: TimelineEvent[] = [
      { t: 1000, type: 'typing', rect },
      { t: 1400, type: 'typing', rect },
      { t: 1900, type: 'typing', rect },
    ];
    const [r] = buildAutoZoomRegions(events, { ...settings, followCursor: false }, 10_000);
    expect(r.start).toBe(500);
    expect(r.end).toBe(3900);
    expect(r.focus!.x).toBeCloseTo(0.2);
    expect(r.focus!.y).toBeCloseTo(0.425);
    expect(r.scale).toBe(2);
  });

  it('limits typing zoom so wide elements still fit', () => {
    const rect = { x: 0, y: 0.4, w: 0.6, h: 0.1 };
    const [r] = buildAutoZoomRegions([{ t: 1000, type: 'typing', rect }], { ...settings, intensity: 3 }, 10_000);
    expect(r.scale).toBeCloseTo(0.8 / 0.6);
  });

  it('keeps region ids stable when timing settings change', () => {
    const [a] = buildAutoZoomRegions([click(3000)], settings, 10_000);
    const [b] = buildAutoZoomRegions([click(3000)], { ...settings, transitionMs: 900, duration: 4000 }, 10_000);
    expect(a.id).toBe(b.id);
  });

  it('clamps regions to the recording', () => {
    const [r] = buildAutoZoomRegions([click(100)], settings, 1500);
    expect(r.start).toBe(0);
    expect(r.end).toBe(1500);
  });
});

describe('buildMotionZoomRegions', () => {
  it('zooms into localized on-screen activity', () => {
    const activity = [
      { t: 1000, bbox: { x: 0.6, y: 0.6, w: 0.1, h: 0.1 }, amount: 0.01 },
      { t: 1500, bbox: { x: 0.62, y: 0.6, w: 0.1, h: 0.1 }, amount: 0.01 },
    ];
    const regions = buildMotionZoomRegions(activity, settings, 10_000);
    expect(regions).toHaveLength(1);
    expect(regions[0].focus!.x).toBeCloseTo(0.66);
    expect(regions[0].scale).toBe(2);
  });

  it('ignores full-screen changes and noise', () => {
    const activity = [
      { t: 1000, bbox: { x: 0, y: 0, w: 1, h: 1 }, amount: 0.8 },
      { t: 2000, bbox: { x: 0.5, y: 0.5, w: 0.01, h: 0.01 }, amount: 0.00001 },
      { t: 3000, bbox: null, amount: 0 },
    ];
    expect(buildMotionZoomRegions(activity, settings, 10_000)).toEqual([]);
  });
});

describe('combineZoomRegions', () => {
  it('lets manual keyframes replace overlapping automatic zooms', () => {
    const auto: ZoomRegion[] = [
      { id: 'a1', start: 0, end: 2000, scale: 2, focus: null, source: 'auto' },
      { id: 'a2', start: 5000, end: 7000, scale: 2, focus: null, source: 'auto' },
    ];
    const manual: ZoomRegion[] = [{ id: 'm1', start: 1500, end: 3000, scale: 3, focus: { x: 0.5, y: 0.5 }, source: 'manual' }];
    expect(combineZoomRegions(auto, manual).map((r) => r.id)).toEqual(['m1', 'a2']);
  });
});

describe('zoomScaleAt', () => {
  const regions: ZoomRegion[] = [{ id: 'r', start: 1000, end: 4000, scale: 2, focus: null, source: 'auto' }];

  it('is 1 outside regions', () => {
    expect(zoomScaleAt(regions, 500, 500).scale).toBe(1);
    expect(zoomScaleAt(regions, 4500, 500).scale).toBe(1);
  });

  it('eases in and out over the transition', () => {
    expect(zoomScaleAt(regions, 1000, 500).scale).toBe(1);
    expect(zoomScaleAt(regions, 1250, 500).scale).toBeCloseTo(1.5);
    expect(zoomScaleAt(regions, 2000, 500).scale).toBe(2);
    expect(zoomScaleAt(regions, 3750, 500).scale).toBeCloseTo(1.5);
    expect(zoomScaleAt(regions, 2000, 500).region?.id).toBe('r');
  });
});
