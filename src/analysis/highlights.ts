import type { Range, TimelineEvent } from '../shared/types';
import type { ActivitySample } from '../effects/zoom';

const WEIGHTS: Partial<Record<TimelineEvent['type'], number>> = {
  click: 3,
  key: 2,
  typing: 0.5,
  scroll: 0.5,
  page: 1,
  marker: 100,
};

const BUCKET_MS = 1000;

/**
 * Picks the most eventful moments: windows dense with clicks, shortcuts, typing
 * and on-screen activity. Manual markers always win.
 */
export function detectHighlights(
  events: TimelineEvent[],
  activity: ActivitySample[],
  duration: number,
  opts: { windowMs: number; count: number }
): Range[] {
  const weighted: { t: number; w: number }[] = [];
  for (const e of events) {
    const w = WEIGHTS[e.type];
    if (w) weighted.push({ t: e.t, w });
  }
  for (const a of activity) {
    if (a.bbox && a.bbox.w * a.bbox.h < 0.5) weighted.push({ t: a.t, w: Math.min(2, a.amount * 20) });
  }
  if (!weighted.length || duration <= 0) return [];

  const buckets = new Float64Array(Math.ceil(duration / BUCKET_MS) + 1);
  for (const { t, w } of weighted) buckets[Math.min(buckets.length - 1, Math.floor(t / BUCKET_MS))] += w;

  const windowBuckets = Math.max(1, Math.round(opts.windowMs / BUCKET_MS));
  const windowLen = Math.min(opts.windowMs, duration);
  const picked: Range[] = [];
  const taken = new Uint8Array(buckets.length);

  for (let n = 0; n < opts.count; n++) {
    let best = -1;
    let bestScore = 0;
    for (let s = 0; s + windowBuckets <= buckets.length; s++) {
      let score = 0;
      let blocked = false;
      for (let k = s; k < s + windowBuckets; k++) {
        if (taken[k]) {
          blocked = true;
          break;
        }
        score += buckets[k];
      }
      if (!blocked && score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (best < 0) break;

    // Center the window on the weighted activity inside it
    const from = best * BUCKET_MS;
    const to = from + windowBuckets * BUCKET_MS;
    const inside = weighted.filter((x) => x.t >= from && x.t < to);
    const mass = inside.reduce((s, x) => s + x.w, 0);
    const centroid = inside.reduce((s, x) => s + x.t * x.w, 0) / mass;
    const start = Math.max(0, Math.min(duration - windowLen, centroid - windowLen / 2));
    picked.push({ start, end: start + windowLen });

    for (let k = best; k < best + windowBuckets; k++) taken[k] = 1;
  }

  return picked.sort((a, b) => a.start - b.start);
}
