import type { Range, SubtitleCue } from '../shared/types';
import { sourceToOutput } from '../editor/timeline';

/**
 * Subtitle model: cues are kept in source time (like cuts and zooms) and mapped to
 * output time only when exported, so they stay in sync however the recording is cut.
 */

/** A recognized word, ms */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface CueOptions {
  maxChars: number;
  maxLines?: number;
  maxDurationMs?: number;
  /** A pause longer than this starts a new cue */
  maxGapMs?: number;
}

/** Shortest time a cue stays on screen, unless the next cue starts sooner */
const MIN_CUE_MS = 800;
/** Cues can't be split closer than this to either edge */
const MIN_SPLIT_MS = 200;
/** Cues shorter than this in the output (e.g. mostly cut away) are dropped from exports */
const MIN_EXPORT_MS = 50;
/** Assumed length of a word whose end time is missing */
const FALLBACK_WORD_MS = 300;
/** Whisper sometimes stretches the last word over the silence after it; no spoken word is longer */
const MAX_WORD_MS = 1500;

let idCounter = 0;
export const newCueId = () => `sub-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export const sortCues = (cues: SubtitleCue[]) => [...cues].sort((a, b) => a.start - b.start);

/** Whisper marks non-speech with tags like [BLANK_AUDIO] or [Music] */
const NON_SPEECH = /^\s*(\[[^\]]*\]|[♪♫\s]*)\s*$/;

/** Drops non-speech tags and repairs missing, backwards or overlong word timings */
export function cleanWords(words: TimedWord[]): TimedWord[] {
  const kept = words.filter((w) => w.text.trim() && !NON_SPEECH.test(w.text));
  return kept.map((w, i) => {
    let end = w.end;
    if (!(end > w.start)) {
      const next = kept[i + 1];
      end = next && next.start > w.start ? next.start : w.start + FALLBACK_WORD_MS;
    }
    end = Math.min(end, w.start + MAX_WORD_MS);
    return end === w.end ? w : { ...w, end };
  });
}

/** Whisper words carry their own leading space (none for languages written without spaces) */
const joinWords = (words: TimedWord[]) => words.map((w) => w.text).join('').replace(/\s+/g, ' ').trim();

/** Groups words into readable cues: at most `maxLines` lines, broken at pauses and sentence ends */
export function wordsToCues(words: TimedWord[], opts: CueOptions): SubtitleCue[] {
  const maxLen = opts.maxChars * (opts.maxLines ?? 2);
  const maxDuration = opts.maxDurationMs ?? 6000;
  const maxGap = opts.maxGapMs ?? 1000;
  const cues: SubtitleCue[] = [];
  let current: TimedWord[] = [];

  const flush = () => {
    const text = joinWords(current);
    if (text) cues.push({ id: newCueId(), start: current[0].start, end: current[current.length - 1].end, text });
    current = [];
  };

  for (const w of words) {
    if (current.length) {
      const last = current[current.length - 1];
      if (
        w.start - last.end > maxGap ||
        joinWords([...current, w]).length > maxLen ||
        w.start - current[0].start > maxDuration
      ) {
        flush();
      }
    }
    current.push(w);
    if (/[.?!。？！…]["'”’)]?$/.test(w.text.trim()) && joinWords(current).length >= opts.maxChars / 2) flush();
  }
  flush();

  // Keep short cues readable without running into the next one
  return cues.map((c, i) => {
    const next = cues[i + 1];
    return { ...c, end: Math.min(Math.max(c.end, c.start + MIN_CUE_MS), next ? next.start : Infinity) };
  });
}

/** The cue showing at source time `t` (cues sorted by start) */
export function subtitleAt(cues: SubtitleCue[], t: number): SubtitleCue | null {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // A long earlier cue may still be showing behind any number of shorter later ones
  for (let i = found; i >= 0; i--) {
    if (t < cues[i].end) return cues[i];
  }
  return null;
}

/**
 * Word-wraps text to `max` (characters by default, or any unit via `measure`).
 * Two-line results are balanced so the second line isn't a lone word.
 */
export function wrapText(text: string, max: number, measure: (s: string) => number = (s) => s.length): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (line && measure(candidate) > max) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  if (lines.length !== 2) return lines;

  let best = lines;
  let bestWidth = Math.max(measure(lines[0]), measure(lines[1]));
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(' ');
    const b = words.slice(k).join(' ');
    const width = Math.max(measure(a), measure(b));
    if (width < bestWidth) {
      best = [a, b];
      bestWidth = width;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Editing                                                             */
/* ------------------------------------------------------------------ */

/** Splits a cue at source time `t`, dividing its text at the nearest word boundary */
export function splitCue(cues: SubtitleCue[], id: string, t: number): SubtitleCue[] {
  const c = cues.find((x) => x.id === id);
  if (!c || t <= c.start + MIN_SPLIT_MS || t >= c.end - MIN_SPLIT_MS) return cues;
  const words = c.text.split(/\s+/).filter(Boolean);
  // A single word can't be divided; splitting would leave a blank cue
  if (words.length < 2) return cues;
  const target = (c.text.length * (t - c.start)) / (c.end - c.start);
  let k = words.length;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      k = i;
    }
  }
  const first: SubtitleCue = { ...c, end: t, text: words.slice(0, k).join(' ') };
  const second: SubtitleCue = { id: newCueId(), start: t, end: c.end, text: words.slice(k).join(' ') };
  return sortCues(cues.flatMap((x) => (x.id === id ? [first, second] : [x])));
}

export function mergeWithNext(cues: SubtitleCue[], id: string): SubtitleCue[] {
  const sorted = sortCues(cues);
  const i = sorted.findIndex((c) => c.id === id);
  if (i < 0 || i === sorted.length - 1) return cues;
  const a = sorted[i];
  const b = sorted[i + 1];
  const merged: SubtitleCue = { ...a, end: Math.max(a.end, b.end), text: `${a.text} ${b.text}`.trim() };
  return [...sorted.slice(0, i), merged, ...sorted.slice(i + 2)];
}

/**
 * Moves every cue by `delta` ms (fixes an overall sync offset).
 * The shift stops at the edges of the recording rather than squashing or dropping
 * the cues that reach them, so nudging back and forth is always reversible.
 */
export function shiftCues(cues: SubtitleCue[], delta: number, duration: number): SubtitleCue[] {
  if (!cues.length || !delta) return cues;
  const earliest = Math.min(...cues.map((c) => c.start));
  const latest = Math.max(...cues.map((c) => c.end));
  const room = Math.min(Math.max(delta, -earliest), duration - latest);
  // Cues already longer than the recording leave no room to move
  if (Math.sign(room) !== Math.sign(delta)) return cues;
  return cues.map((c) => ({ ...c, start: c.start + room, end: c.end + room }));
}

/* ------------------------------------------------------------------ */
/* Transcription planning                                              */
/* ------------------------------------------------------------------ */

export interface ChunkOptions {
  /** Whisper's window is 30 s; stay a bit under it */
  maxMs: number;
  /** How far back from the limit to look for a pause to split at */
  searchMs: number;
  /** Chunks never louder than this are skipped (Whisper invents text on silence) */
  silenceDb: number;
}

/**
 * Splits the recording into speech chunks for transcription, cutting at the quietest
 * moment near each limit so words aren't chopped in half, and skipping silent chunks.
 */
export function planChunks(envelope: Float32Array, windowMs: number, durationMs: number, opts: ChunkOptions): Range[] {
  const threshold = Math.pow(10, opts.silenceDb / 20);
  const level = (i: number) => (i >= 0 && i < envelope.length ? envelope[i] : 0);
  const out: Range[] = [];

  let start = 0;
  while (start < durationMs) {
    let end = start + opts.maxMs;
    if (end >= durationMs) {
      end = durationMs;
    } else {
      // Latest quietest window, so chunks stay as long as possible
      const from = Math.ceil(Math.max(start, end - opts.searchMs) / windowMs);
      const to = Math.floor(end / windowMs);
      let best = to - 1;
      let bestLevel = Infinity;
      for (let i = from; i < to; i++) {
        if (level(i) <= bestLevel) {
          bestLevel = level(i);
          best = i;
        }
      }
      end = Math.max(start + windowMs, best * windowMs + windowMs / 2);
    }

    let peak = 0;
    for (let i = Math.floor(start / windowMs); i < Math.ceil(end / windowMs); i++) peak = Math.max(peak, level(i));
    if (peak >= threshold) out.push({ start, end });
    start = end;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* SRT / WebVTT                                                        */
/* ------------------------------------------------------------------ */

function timestamp(ms: number, separator: ',' | '.'): string {
  const total = Math.max(0, Math.round(ms));
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(total % 1000, 3)}`;
}

/** Cues mapped to the edited (output) timeline; cues that were cut away are dropped */
export function outputCues(cues: SubtitleCue[], duration: number, cuts: Range[]): { start: number; end: number; text: string }[] {
  return sortCues(cues)
    .map((c) => ({
      start: sourceToOutput(c.start, duration, cuts),
      end: sourceToOutput(c.end, duration, cuts),
      text: c.text.trim(),
    }))
    .filter((c) => c.text && c.end - c.start >= MIN_EXPORT_MS);
}

export function toSrt(cues: SubtitleCue[], duration: number, cuts: Range[], maxChars = 42): string {
  return outputCues(cues, duration, cuts)
    .map(
      (c, i) =>
        `${i + 1}\n${timestamp(c.start, ',')} --> ${timestamp(c.end, ',')}\n${wrapText(c.text, maxChars).join('\n')}\n`
    )
    .join('\n');
}

export function toVtt(cues: SubtitleCue[], duration: number, cuts: Range[], maxChars = 42): string {
  const body = outputCues(cues, duration, cuts)
    .map((c) => `${timestamp(c.start, '.')} --> ${timestamp(c.end, '.')}\n${wrapText(c.text, maxChars).join('\n')}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/;

function parseTime(s: string): number | null {
  const m = TIME.exec(s.trim());
  if (!m) return null;
  const [, h, min, sec, frac] = m;
  return (Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec)) * 1000 + Number(frac.padEnd(3, '0'));
}

/** Parses SRT or WebVTT text. Times are as written in the file (i.e. output time). */
export function parseSubtitles(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (const block of text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const m = /^\s*(\S+)\s*-->\s*(\S+)/.exec(lines[i]);
    const start = m ? parseTime(m[1]) : null;
    const end = m ? parseTime(m[2]) : null;
    if (start === null || end === null || end <= start) continue;
    const body = lines
      .slice(i + 1)
      .map((l) => l.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').trim())
      .filter(Boolean)
      .join(' ');
    if (body) out.push({ start, end, text: body });
  }
  return out.sort((a, b) => a.start - b.start);
}
