import type { Chapter, Rect, TimelineEvent } from '../shared/types';

export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    out[i] = Math.round(rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114);
  }
  return out;
}

/** Mean absolute difference between two grayscale frames, 0..1 */
export function frameDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 255);
}

/** Bounding box (normalized) and fraction of pixels that changed between frames */
export function changeBox(
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  height: number,
  pixelThreshold = 24
): { bbox: Rect | null; amount: number } {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (Math.abs(a[i] - b[i]) > pixelThreshold) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (count === 0) return { bbox: null, amount: 0 };
  return {
    bbox: {
      x: minX / width,
      y: minY / height,
      w: (maxX - minX + 1) / width,
      h: (maxY - minY + 1) / height,
    },
    amount: count / (width * height),
  };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Times of sudden, large visual changes (robust to overall busy recordings) */
export function detectSceneCuts(
  samples: { t: number; diff: number }[],
  opts: { minDiff: number; minGapMs: number }
): number[] {
  const diffs = samples.map((s) => s.diff);
  const med = median(diffs);
  const mad = median(diffs.map((d) => Math.abs(d - med)));
  const threshold = Math.max(opts.minDiff, med + 6 * mad);

  const cuts: number[] = [];
  for (const s of samples) {
    if (s.diff < threshold) continue;
    if (cuts.length && s.t - cuts[cuts.length - 1] < opts.minGapMs) continue;
    cuts.push(s.t);
  }
  return cuts;
}

/**
 * Chapter markers from page changes (named after the page) and scene cuts.
 * Page changes win over nearby scene cuts.
 */
export function buildChapters(
  sceneCuts: number[],
  events: TimelineEvent[],
  duration: number,
  minGapMs: number
): Chapter[] {
  const pages: { t: number; title: string }[] = [];
  for (const e of events) {
    if (e.type !== 'page' || !e.title) continue;
    if (pages.length && pages[pages.length - 1].title === e.title) continue;
    pages.push({ t: e.t, title: e.title });
  }

  const points: { t: number; page: string | null }[] = [{ t: 0, page: pages.find((p) => p.t === 0)?.title ?? null }];
  const farFromAll = (t: number) => points.every((p) => Math.abs(p.t - t) >= minGapMs);

  for (const p of pages) {
    if (p.t > 0 && p.t < duration && farFromAll(p.t)) points.push({ t: p.t, page: p.title });
  }
  for (const c of sceneCuts) {
    if (c > 0 && c < duration && farFromAll(c)) points.push({ t: c, page: null });
  }
  points.sort((a, b) => a.t - b.t);

  const pageAt = (t: number) => {
    let title: string | null = null;
    for (const p of pages) if (p.t <= t) title = p.title;
    return title;
  };

  const seen = new Map<string, number>();
  return points.map((p, i) => {
    const base = p.page ?? pageAt(p.t);
    if (!base) return { t: p.t, title: `Chapter ${i + 1}` };
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { t: p.t, title: n > 1 ? `${base} (${n})` : base };
  });
}
