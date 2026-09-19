import type { Point, Rect } from '../shared/types';

/** Samples interpolated only when closer than this; otherwise the cursor holds still */
const MAX_INTERPOLATION_GAP_MS = 250;
/** How far back to look for the element being typed into */
const TYPING_LOOKBACK_MS = 10_000;

/** Index of the last item with t <= time, or -1 (items sorted by t) */
export function lastIndexAtOrBefore<T extends { t: number }>(items: T[], time: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].t <= time) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function cursorAt(moves: { t: number; x: number; y: number }[], t: number): Point | null {
  const i = lastIndexAtOrBefore(moves, t);
  if (i < 0) return null;
  const a = moves[i];
  const b = moves[i + 1];
  // Never blend toward/away from an off-surface marker (negative coordinates)
  const offSurface = (p: { x: number }) => p.x < 0;
  if (!b || b.t - a.t > MAX_INTERPOLATION_GAP_MS || offSurface(a) || offSurface(b)) return { x: a.x, y: a.y };
  const k = (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

export interface ActiveClick extends Point {
  /** 0..1 through the click animation */
  progress: number;
  /** 1-based click number, for tutorial step badges */
  step: number;
}

export function activeClicks(
  clicks: { t: number; x: number; y: number }[],
  t: number,
  durationMs: number
): ActiveClick[] {
  const out: ActiveClick[] = [];
  const last = lastIndexAtOrBefore(clicks, t);
  for (let i = last; i >= 0; i--) {
    const age = t - clicks[i].t;
    if (age >= durationMs) break;
    out.unshift({ x: clicks[i].x, y: clicks[i].y, progress: age / durationMs, step: i + 1 });
  }
  return out;
}

/** The element being typed into, while typing is recent */
export function typingFocusAt(
  typing: { t: number; rect: Rect | null }[],
  t: number,
  holdMs: number
): Rect | null {
  const i = lastIndexAtOrBefore(typing, t);
  if (i < 0 || t - typing[i].t > holdMs) return null;
  for (let j = i; j >= 0 && t - typing[j].t <= TYPING_LOOKBACK_MS; j--) {
    if (typing[j].rect) return typing[j].rect;
  }
  return null;
}

export function scrollActivityAt(
  scrolls: { t: number; dy: number }[],
  t: number,
  windowMs: number
): { direction: 1 | -1; strength: number } | null {
  const i = lastIndexAtOrBefore(scrolls, t);
  if (i < 0) return null;
  const age = t - scrolls[i].t;
  if (age > windowMs) return null;
  return { direction: scrolls[i].dy >= 0 ? 1 : -1, strength: 1 - age / windowMs };
}

export interface KeystrokeDisplayOptions {
  holdMs: number;
  fadeMs: number;
  chainGapMs: number;
  maxItems: number;
}

export function visibleKeystrokes(
  keys: { t: number; label: string }[],
  t: number,
  opts: KeystrokeDisplayOptions
): { labels: string[]; opacity: number } | null {
  const i = lastIndexAtOrBefore(keys, t);
  if (i < 0) return null;
  const age = t - keys[i].t;
  if (age > opts.holdMs + opts.fadeMs) return null;

  let first = i;
  while (first > 0 && keys[first].t - keys[first - 1].t <= opts.chainGapMs) first--;

  const grouped: { label: string; count: number }[] = [];
  for (let j = first; j <= i; j++) {
    const last = grouped[grouped.length - 1];
    if (last && last.label === keys[j].label) last.count++;
    else grouped.push({ label: keys[j].label, count: 1 });
  }

  const labels = grouped
    .map((g) => (g.count > 1 ? `${g.label} ×${g.count}` : g.label))
    .slice(-opts.maxItems);
  const opacity = age <= opts.holdMs ? 1 : 1 - (age - opts.holdMs) / opts.fadeMs;
  return { labels, opacity };
}
