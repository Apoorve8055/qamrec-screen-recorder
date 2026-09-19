import type { Point, Rect, TimelineEvent, ZoomRegion, ZoomSettings } from '../shared/types';

/** Localized on-screen change, sampled from the recording (see analysis/scenes.ts) */
export interface ActivitySample {
  t: number;
  bbox: Rect | null;
  /** Fraction of pixels that changed */
  amount: number;
}

interface Candidate {
  /** Time of the triggering event; identifies the region across setting changes */
  anchor: number;
  start: number;
  end: number;
  scale: number;
  focus: Point | null;
}

const TYPING_GAP_MS = 1500;
const MOTION_GAP_MS = 1500;
const MIN_USEFUL_SCALE = 1.15;
const MOTION_MIN_AMOUNT = 0.002;
const MOTION_MAX_AREA = 0.2;

const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Largest scale (up to `max`) at which a rect still fits comfortably in view */
function fitScale(rect: Rect, max: number, fill: number): number {
  return Math.min(max, fill / Math.max(rect.w, 1e-6), fill / Math.max(rect.h, 1e-6));
}

function mergeCandidates(
  candidates: Candidate[],
  settings: ZoomSettings,
  duration: number,
  barriers: number[],
  idPrefix: string
): ZoomRegion[] {
  const sorted = [...candidates].sort((a, b) => a.start - b.start);
  const merged: Candidate[] = [];

  for (const c of sorted) {
    const last = merged[merged.length - 1];
    const blocked = last && barriers.some((b) => b >= last.end - 1 && b <= c.start);
    if (last && !blocked && c.start - last.end < settings.transitionMs) {
      last.end = Math.max(last.end, c.end);
      last.scale = Math.max(last.scale, c.scale);
      if (settings.followCursor || !last.focus || !c.focus) last.focus = null;
      else last.focus = c.focus;
    } else {
      merged.push({ ...c });
    }
  }

  return merged
    .map((c) => ({ ...c, start: Math.max(0, c.start), end: Math.min(duration, c.end) }))
    .filter((c) => c.end > c.start)
    .map((c) => ({
      // Keyed on the triggering event so user-deleted auto zooms stay deleted when timing settings change
      id: `${idPrefix}-${Math.round(c.anchor)}`,
      start: c.start,
      end: c.end,
      scale: c.scale,
      focus: c.focus,
      source: 'auto' as const,
    }));
}

/**
 * Automatic zoom from interaction events: clicks zoom in (arriving exactly at the click),
 * typing frames the focused element, and scrolling zooms back out.
 */
export function buildAutoZoomRegions(
  events: TimelineEvent[],
  settings: ZoomSettings,
  duration: number
): ZoomRegion[] {
  if (!settings.auto) return [];
  const { transitionMs: tr, duration: hold, intensity } = settings;
  const scrolls = events.filter((e) => e.type === 'scroll').map((e) => e.t);
  const firstScrollIn = (from: number, to: number) => scrolls.find((s) => s > from && s < to);

  const candidates: Candidate[] = [];

  for (const e of events) {
    if (e.type !== 'click') continue;
    let end = e.t + hold;
    const scroll = firstScrollIn(e.t, end);
    if (scroll !== undefined) end = scroll;
    candidates.push({
      anchor: e.t,
      start: e.t - tr,
      end: Math.max(end, e.t - tr + tr * 1.5),
      scale: intensity,
      focus: settings.followCursor ? null : { x: e.x, y: e.y },
    });
  }

  if (settings.typingFocus) {
    const typing = events.filter((e): e is Extract<TimelineEvent, { type: 'typing' }> => e.type === 'typing');
    let session: { first: number; last: number; rect: Rect | null } | null = null;
    const flush = () => {
      if (!session || !session.rect) return;
      const scale = fitScale(session.rect, intensity, 0.8);
      if (scale < MIN_USEFUL_SCALE) return;
      candidates.push({
        anchor: session.first,
        start: session.first - tr,
        end: session.last + hold,
        scale,
        focus: center(session.rect),
      });
    };
    for (const e of typing) {
      if (session && e.t - session.last < TYPING_GAP_MS) {
        session.last = e.t;
        session.rect = e.rect ?? session.rect;
      } else {
        flush();
        session = { first: e.t, last: e.t, rect: e.rect };
      }
    }
    flush();
  }

  return mergeCandidates(candidates, settings, duration, scrolls, 'auto');
}

/**
 * Smart auto-framing for recordings without page tracking (e.g. other desktop apps):
 * zooms into areas of localized, sustained on-screen activity.
 */
export function buildMotionZoomRegions(
  activity: ActivitySample[],
  settings: ZoomSettings,
  duration: number
): ZoomRegion[] {
  if (!settings.auto) return [];
  const { transitionMs: tr, duration: hold, intensity } = settings;
  const candidates: Candidate[] = [];
  let group: { first: number; last: number; box: Rect } | null = null;

  const flush = () => {
    if (!group) return;
    const scale = fitScale(group.box, intensity, 0.7);
    if (scale >= MIN_USEFUL_SCALE) {
      candidates.push({ anchor: group.first, start: group.first - tr, end: group.last + hold, scale, focus: center(group.box) });
    }
    group = null;
  };

  for (const s of activity) {
    const localized =
      s.bbox && s.amount >= MOTION_MIN_AMOUNT && s.bbox.w * s.bbox.h <= MOTION_MAX_AREA;
    if (!localized || !s.bbox) {
      // Big changes (scene cuts) end the current group; quiet samples just let it expire
      if (s.bbox && s.bbox.w * s.bbox.h > MOTION_MAX_AREA) flush();
      continue;
    }
    if (group && s.t - group.last < MOTION_GAP_MS) {
      const x0 = Math.min(group.box.x, s.bbox.x);
      const y0 = Math.min(group.box.y, s.bbox.y);
      const x1 = Math.max(group.box.x + group.box.w, s.bbox.x + s.bbox.w);
      const y1 = Math.max(group.box.y + group.box.h, s.bbox.y + s.bbox.h);
      group.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      group.last = s.t;
    } else {
      flush();
      group = { first: s.t, last: s.t, box: { ...s.bbox } };
    }
  }
  flush();

  return mergeCandidates(candidates, { ...settings, followCursor: false }, duration, [], 'motion');
}

/** Manual keyframes win: automatic regions overlapping any manual region are dropped. */
export function combineZoomRegions(auto: ZoomRegion[], manual: ZoomRegion[]): ZoomRegion[] {
  const overlaps = (a: ZoomRegion, b: ZoomRegion) => a.start < b.end && b.start < a.end;
  const keptAuto = auto.filter((a) => !manual.some((m) => overlaps(a, m)));
  return [...manual, ...keptAuto].sort((a, b) => a.start - b.start);
}

export function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

export function zoomScaleAt(
  regions: ZoomRegion[],
  t: number,
  transitionMs: number
): { scale: number; region: ZoomRegion | null } {
  for (const r of regions) {
    if (t < r.start || t > r.end) continue;
    const tr = Math.max(1, transitionMs);
    const p = Math.max(0, Math.min(1, (t - r.start) / tr, (r.end - t) / tr));
    return { scale: 1 + (r.scale - 1) * easeInOutCubic(p), region: r };
  }
  return { scale: 1, region: null };
}
