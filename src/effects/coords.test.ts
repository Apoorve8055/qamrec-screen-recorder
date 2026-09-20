import { describe, it, expect } from 'vitest';
import { mapViewportPoint, mapViewportRect, mappingIsPlausible } from './coords';
import type { ViewportInfo } from '../shared/types';

const vp: ViewportInfo = {
  innerWidth: 1000,
  innerHeight: 600,
  outerWidth: 1016,
  outerHeight: 700,
  screenX: 100,
  screenY: 50,
  screenWidth: 1920,
  screenHeight: 1080,
  screenLeft: 0,
  screenTop: 0,
  dpr: 1,
  title: 'Page',
};

describe('mapViewportPoint', () => {
  it('maps tab captures directly to the viewport', () => {
    expect(mapViewportPoint({ x: 500, y: 150 }, vp, 'tab')).toEqual({ x: 0.5, y: 0.25 });
    expect(mapViewportPoint({ x: 250, y: 300 }, vp, 'browser')).toEqual({ x: 0.25, y: 0.5 });
  });

  it('offsets window captures by the browser chrome', () => {
    // side border = (1016-1000)/2 = 8, top inset = 700 - 600 - 8 = 92
    const p = mapViewportPoint({ x: 0, y: 0 }, vp, 'window');
    expect(p.x).toBeCloseTo(8 / 1016);
    expect(p.y).toBeCloseTo(92 / 700);
  });

  it('offsets monitor captures by window position on screen', () => {
    const p = mapViewportPoint({ x: 10, y: 20 }, vp, 'monitor');
    expect(p.x).toBeCloseTo((100 + 8 + 10) / 1920);
    expect(p.y).toBeCloseTo((50 + 92 + 20) / 1080);
  });

  it('accounts for secondary monitors via screen origin', () => {
    const second = { ...vp, screenX: 2020, screenLeft: 1920 };
    const p = mapViewportPoint({ x: 0, y: 0 }, second, 'monitor');
    expect(p.x).toBeCloseTo((100 + 8) / 1920);
  });
});

describe('mapViewportRect', () => {
  it('maps origin and size', () => {
    const r = mapViewportRect({ x: 100, y: 60, w: 200, h: 30 }, vp, 'tab');
    expect(r.x).toBeCloseTo(0.1);
    expect(r.y).toBeCloseTo(0.1);
    expect(r.w).toBeCloseTo(0.2);
    expect(r.h).toBeCloseTo(0.05);
  });
});

describe('mappingIsPlausible', () => {
  it('accepts captures whose aspect matches the expected surface', () => {
    expect(mappingIsPlausible(vp, 'tab', 2000, 1200)).toBe(true);
    expect(mappingIsPlausible(vp, 'monitor', 3840, 2160)).toBe(true);
    expect(mappingIsPlausible(vp, 'window', 1016, 700)).toBe(true);
  });

  it('rejects captures of some other surface', () => {
    expect(mappingIsPlausible(vp, 'tab', 1920, 1080)).toBe(false);
    expect(mappingIsPlausible(vp, 'window', 800, 800)).toBe(false);
  });

  it('never maps camera captures', () => {
    expect(mappingIsPlausible(vp, 'camera', 1000, 600)).toBe(false);
  });
});
