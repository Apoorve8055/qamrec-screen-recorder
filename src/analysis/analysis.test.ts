import { describe, it, expect } from 'vitest';
import { rmsEnvelope, detectSilences } from './silence';
import { toGray, frameDiff, changeBox, detectSceneCuts, buildChapters } from './scenes';
import { detectHighlights } from './highlights';
import type { TimelineEvent } from '../shared/types';

describe('silence detection', () => {
  const rate = 1000; // 1 sample per ms keeps the math simple

  function signal(parts: [number, number][]): Float32Array {
    // parts: [durationMs, amplitude]
    const total = parts.reduce((s, [d]) => s + d, 0);
    const out = new Float32Array(total);
    let i = 0;
    for (const [d, amp] of parts) {
      for (let k = 0; k < d; k++) out[i++] = amp * (k % 2 ? 1 : -1);
    }
    return out;
  }

  it('computes a mono RMS envelope across channels', () => {
    const left = new Float32Array(100).fill(0.5);
    const right = new Float32Array(100).fill(-0.5);
    const env = rmsEnvelope([left, right], rate, 50);
    expect(env.length).toBe(2);
    expect(env[0]).toBeCloseTo(0.5);
  });

  it('finds long quiet stretches, keeping padding around speech', () => {
    const data = signal([
      [1000, 0.3],
      [3000, 0.0001],
      [1000, 0.3],
      [500, 0.0001], // too short to remove
      [1000, 0.3],
    ]);
    const env = rmsEnvelope([data], rate, 50);
    const silences = detectSilences(env, 50, { thresholdDb: -40, minSilenceMs: 1000, paddingMs: 200 });
    expect(silences).toEqual([{ start: 1200, end: 3800 }]);
  });
});

describe('scene analysis', () => {
  const w = 4;
  const h = 4;
  const rgba = (value: number) => new Uint8ClampedArray(w * h * 4).fill(value);

  it('converts to grayscale and diffs frames', () => {
    const a = toGray(rgba(0), w, h);
    const b = toGray(rgba(255), w, h);
    expect(frameDiff(a, a)).toBe(0);
    expect(frameDiff(a, b)).toBeCloseTo(1);
  });

  it('locates the region that changed', () => {
    const a = new Uint8Array(w * h);
    const b = new Uint8Array(w * h);
    b[1 * w + 2] = 200; // pixel (2,1) changes
    const box = changeBox(a, b, w, h);
    expect(box.bbox).toEqual({ x: 0.5, y: 0.25, w: 0.25, h: 0.25 });
    expect(box.amount).toBeCloseTo(1 / 16);
    expect(changeBox(a, a, w, h).bbox).toBeNull();
  });

  it('flags sudden large changes as scene cuts', () => {
    const samples = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500].map((t) => ({ t, diff: 0.01 }));
    samples[3].diff = 0.6;
    samples[7].diff = 0.5;
    expect(detectSceneCuts(samples, { minDiff: 0.12, minGapMs: 1000 })).toEqual([1500, 3500]);
  });

  it('builds chapters from scene cuts and page changes', () => {
    const events: TimelineEvent[] = [
      { t: 0, type: 'page', title: 'Home' },
      { t: 20_000, type: 'page', title: 'Settings' },
    ];
    const chapters = buildChapters([21_000, 45_000], events, 60_000, 8000);
    expect(chapters).toEqual([
      { t: 0, title: 'Home' },
      { t: 20_000, title: 'Settings' },
      { t: 45_000, title: 'Settings (2)' },
    ]);
  });

  it('names chapters generically when no page titles are known', () => {
    expect(buildChapters([30_000], [], 60_000, 8000)).toEqual([
      { t: 0, title: 'Chapter 1' },
      { t: 30_000, title: 'Chapter 2' },
    ]);
  });
});

describe('detectHighlights', () => {
  it('picks the busiest non-overlapping windows', () => {
    const events: TimelineEvent[] = [];
    for (let i = 0; i < 5; i++) events.push({ t: 10_000 + i * 500, type: 'click', x: 0.5, y: 0.5 });
    events.push({ t: 40_000, type: 'click', x: 0.5, y: 0.5 });
    const highlights = detectHighlights(events, [], 60_000, { windowMs: 6000, count: 2 });
    expect(highlights).toHaveLength(2);
    expect(highlights[0].start).toBeLessThanOrEqual(10_000);
    expect(highlights[0].end).toBeGreaterThanOrEqual(12_000);
    expect(highlights[1].start).toBeLessThanOrEqual(40_000);
    expect(highlights[1].end).toBeGreaterThanOrEqual(40_000);
  });

  it('always includes manual markers', () => {
    const events: TimelineEvent[] = [{ t: 30_000, type: 'marker' }];
    const [h] = detectHighlights(events, [], 60_000, { windowMs: 6000, count: 1 });
    expect(h.start).toBeLessThanOrEqual(30_000);
    expect(h.end).toBeGreaterThanOrEqual(30_000);
  });

  it('returns nothing for an idle recording', () => {
    expect(detectHighlights([], [], 60_000, { windowMs: 6000, count: 3 })).toEqual([]);
  });
});
