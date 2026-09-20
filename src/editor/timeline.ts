import type { Range } from '../shared/types';

/**
 * Trim & cut model. A project keeps a list of removed ("cut") ranges in source time;
 * everything else is kept and played back to back.
 */

export function normalizeRanges(ranges: Range[], duration: number): Range[] {
  const clamped = ranges
    .map((r) => ({ start: Math.max(0, Math.min(r.start, r.end)), end: Math.min(duration, Math.max(r.start, r.end)) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  const out: Range[] = [];
  for (const r of clamped) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

export function keptSegments(duration: number, cuts: Range[]): Range[] {
  const out: Range[] = [];
  let cursor = 0;
  for (const c of normalizeRanges(cuts, duration)) {
    if (c.start > cursor) out.push({ start: cursor, end: c.start });
    cursor = c.end;
  }
  if (cursor < duration) out.push({ start: cursor, end: duration });
  return out;
}

export function outputDuration(duration: number, cuts: Range[]): number {
  return keptSegments(duration, cuts).reduce((sum, s) => sum + (s.end - s.start), 0);
}

export function sourceToOutput(t: number, duration: number, cuts: Range[]): number {
  let out = 0;
  for (const s of keptSegments(duration, cuts)) {
    if (t < s.start) return out;
    if (t <= s.end) return out + (t - s.start);
    out += s.end - s.start;
  }
  return out;
}

export function outputToSource(o: number, duration: number, cuts: Range[]): number {
  const segments = keptSegments(duration, cuts);
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const len = s.end - s.start;
    // Exact segment boundaries map to the start of the next segment
    if (o < acc + len || (i === segments.length - 1 && o <= acc + len)) {
      return s.start + Math.max(0, o - acc);
    }
    acc += len;
  }
  return segments.length ? segments[segments.length - 1].end : duration;
}

/** If t falls inside a cut, the first kept time after it; otherwise t itself */
export function nextKeptTime(t: number, duration: number, cuts: Range[]): number {
  for (const c of normalizeRanges(cuts, duration)) {
    if (t >= c.start && t < c.end) return c.end;
  }
  return t;
}

export function addCut(cuts: Range[], range: Range, duration: number): Range[] {
  return normalizeRanges([...cuts, range], duration);
}

export function removeCutAt(cuts: Range[], t: number): Range[] {
  return cuts.filter((c) => !(t >= c.start && t <= c.end));
}

export function getTrim(cuts: Range[], duration: number): Range {
  const normalized = normalizeRanges(cuts, duration);
  const lead = normalized.find((c) => c.start === 0);
  const tail = normalized.find((c) => c.end === duration);
  return { start: lead ? lead.end : 0, end: tail ? tail.start : duration };
}

export function setTrim(cuts: Range[], duration: number, start: number, end: number): Range[] {
  const inner = normalizeRanges(cuts, duration).filter((c) => c.start !== 0 && c.end !== duration);
  return normalizeRanges(
    [...inner, { start: 0, end: start }, { start: end, end: duration }],
    duration
  );
}
