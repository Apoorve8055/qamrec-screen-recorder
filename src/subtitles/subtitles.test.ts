import { describe, it, expect } from 'vitest';
import {
  cleanWords,
  mergeWithNext,
  parseSubtitles,
  planChunks,
  shiftCues,
  splitCue,
  subtitleAt,
  toSrt,
  toVtt,
  wordsToCues,
  wrapText,
  type TimedWord,
} from './subtitles';
import { accumulateMono, finishMono } from './audio';
import type { SubtitleCue } from '../shared/types';

const cue = (id: string, start: number, end: number, text: string): SubtitleCue => ({ id, start, end, text });

/** Words 400 ms long with no gaps */
function words(text: string, start = 0, gap = 0): TimedWord[] {
  let t = start;
  return text.split(' ').map((w, i) => {
    const word = { text: (i ? ' ' : '') + w, start: t, end: t + 400 };
    t += 400 + gap;
    return word;
  });
}

describe('wordsToCues', () => {
  const opts = { maxChars: 20, maxLines: 2, maxDurationMs: 6000, maxGapMs: 1000 };

  it('groups words into cues no longer than two lines', () => {
    const cues = wordsToCues(words('one two three four five six seven eight nine ten eleven twelve'), opts);
    expect(cues.length).toBe(2);
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(40);
    expect(cues.map((c) => c.text).join(' ')).toBe('one two three four five six seven eight nine ten eleven twelve');
    expect(cues[0].start).toBe(0);
    expect(cues[1].start).toBe(cues[0].end);
  });

  it('starts a new cue after a pause', () => {
    const cues = wordsToCues([...words('hello there'), ...words('after pause', 3000)], opts);
    expect(cues.map((c) => c.text)).toEqual(['hello there', 'after pause']);
  });

  it('ends a cue at the end of a sentence once it has some text', () => {
    const cues = wordsToCues(words('This is the first one. And the second'), opts);
    expect(cues[0].text).toBe('This is the first one.');
    expect(cues[1].text).toBe('And the second');
  });

  it('keeps cues on screen long enough without overlapping the next one', () => {
    const cues = wordsToCues(
      [
        { text: 'Hi.', start: 0, end: 100 },
        { text: ' Next', start: 2000, end: 2400 },
      ],
      opts
    );
    expect(cues[0].end).toBeGreaterThanOrEqual(700);
    expect(cues[0].end).toBeLessThanOrEqual(cues[1].start);
  });

  it('gives every cue a unique id', () => {
    const cues = wordsToCues([...words('a b'), ...words('c d', 5000), ...words('e f', 9000)], opts);
    expect(new Set(cues.map((c) => c.id)).size).toBe(cues.length);
  });
});

describe('cleanWords', () => {
  it('drops Whisper non-speech tags and empty words', () => {
    const cleaned = cleanWords([
      { text: ' [BLANK_AUDIO]', start: 0, end: 1000 },
      { text: ' Hello', start: 1000, end: 1300 },
      { text: ' ', start: 1300, end: 1310 },
      { text: ' [Music]', start: 1400, end: 2000 },
      { text: ' world', start: 2000, end: 2300 },
    ]);
    expect(cleaned.map((w) => w.text)).toEqual([' Hello', ' world']);
  });

  it('caps words that Whisper stretches over the following silence', () => {
    const cleaned = cleanWords([
      { text: ' your', start: 10_080, end: 10_400 },
      { text: ' country', start: 10_560, end: 16_000 },
    ]);
    expect(cleaned[1].end - cleaned[1].start).toBeLessThanOrEqual(1500);
  });

  it('keeps a sentence tail with its cue instead of orphaning it', () => {
    const cues = wordsToCues(
      cleanWords([
        ...words('country can do for you ask what you can do for your', 6400),
        { text: ' country', start: 11_300, end: 16_000 },
      ]),
      { maxChars: 42 }
    );
    expect(cues.length).toBe(1);
  });

  it('repairs missing or reversed end times', () => {
    const cleaned = cleanWords([
      { text: 'a', start: 0, end: NaN },
      { text: ' b', start: 500, end: 400 },
    ]);
    expect(cleaned[0].end).toBe(500);
    expect(cleaned[1].end).toBeGreaterThan(500);
  });
});

describe('subtitleAt', () => {
  const cues = [cue('a', 0, 1000, 'A'), cue('b', 2000, 3000, 'B'), cue('c', 3000, 4000, 'C')];
  it('finds the cue showing at a time', () => {
    expect(subtitleAt(cues, 500)?.id).toBe('a');
    expect(subtitleAt(cues, 1500)).toBeNull();
    expect(subtitleAt(cues, 3000)?.id).toBe('c');
    expect(subtitleAt(cues, 5000)).toBeNull();
    expect(subtitleAt([], 0)).toBeNull();
  });
});

describe('wrapText', () => {
  it('wraps on word boundaries', () => {
    expect(wrapText('the quick brown fox jumps over', 15)).toEqual(['the quick brown', 'fox jumps over']);
  });
  it('balances two lines instead of leaving an orphan', () => {
    const lines = wrapText('one two three four five six seven eight', 30);
    expect(lines.length).toBe(2);
    expect(Math.abs(lines[0].length - lines[1].length)).toBeLessThan(12);
  });
  it('keeps short text on one line', () => {
    expect(wrapText('short', 40)).toEqual(['short']);
  });
});

describe('SRT / VTT', () => {
  const cues = [cue('a', 1000, 2500, 'Hello world'), cue('b', 4000, 5000, 'Second line'), cue('c', 6000, 7000, 'Cut out')];

  it('writes SRT in output time, dropping cues inside cuts', () => {
    const srt = toSrt(cues, 10_000, [{ start: 3000, end: 3500 }, { start: 5500, end: 7500 }]);
    expect(srt).toBe('1\n00:00:01,000 --> 00:00:02,500\nHello world\n\n2\n00:00:03,500 --> 00:00:04,500\nSecond line\n');
  });

  it('writes WebVTT', () => {
    const vtt = toVtt(cues.slice(0, 1), 10_000, []);
    expect(vtt).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello world\n');
  });

  it('round-trips through the parser', () => {
    const parsed = parseSubtitles(toSrt(cues, 10_000, []));
    expect(parsed).toEqual(cues.map(({ start, end, text }) => ({ start, end, text })));
  });

  it('parses VTT with hours omitted, cue settings, tags and notes', () => {
    const vtt = [
      'WEBVTT',
      '',
      'NOTE a comment',
      '',
      'intro',
      '01:02.500 --> 01:04.000 align:start',
      '<b>Bold</b> text',
      'second line',
      '',
      '1:00:00.000 --> 1:00:01.250',
      '{\\an8}Late',
    ].join('\r\n');
    expect(parseSubtitles(vtt)).toEqual([
      { start: 62_500, end: 64_000, text: 'Bold text second line' },
      { start: 3_600_000, end: 3_601_250, text: 'Late' },
    ]);
  });
});

describe('cue editing', () => {
  it('splits a cue at a time, dividing the text at a word boundary', () => {
    const out = splitCue([cue('a', 0, 4000, 'one two three four')], 'a', 2000);
    expect(out.map((c) => [c.start, c.end, c.text])).toEqual([
      [0, 2000, 'one two'],
      [2000, 4000, 'three four'],
    ]);
    expect(out[0].id).toBe('a');
    expect(out[1].id).not.toBe('a');
  });

  it('does not split too close to an edge', () => {
    const cues = [cue('a', 0, 4000, 'one two')];
    expect(splitCue(cues, 'a', 50)).toBe(cues);
  });

  it('merges a cue with the next one', () => {
    const out = mergeWithNext([cue('a', 0, 1000, 'Hello'), cue('b', 1200, 2000, 'world'), cue('c', 3000, 4000, 'x')], 'a');
    expect(out).toEqual([cue('a', 0, 2000, 'Hello world'), cue('c', 3000, 4000, 'x')]);
  });

  it('shifts all cues, stopping at the edges without changing their length', () => {
    const out = shiftCues([cue('a', 100, 1000, 'A'), cue('b', 9000, 9800, 'B')], -500, 10_000);
    // Only 100 ms of room before the first cue hits 0, and every cue keeps its length
    expect(out.map((c) => [c.start, c.end])).toEqual([
      [0, 900],
      [8900, 9700],
    ]);
  });

  it('keeps edge cues instead of deleting them, and the shift is reversible', () => {
    const cues = [cue('a', 9500, 9900, 'A')];
    const forward = shiftCues(cues, 1000, 10_000);
    expect(forward.map((c) => [c.start, c.end])).toEqual([[9600, 10_000]]);
    expect(shiftCues(forward, -1000, 10_000).map((c) => [c.start, c.end])).toEqual([[8600, 9000]]);
  });

  it('leaves cues alone when there is no room to move', () => {
    const cues = [cue('a', 0, 10_000, 'A')];
    expect(shiftCues(cues, 500, 10_000)).toEqual(cues);
    expect(shiftCues(cues, -500, 10_000)).toEqual(cues);
  });
});

describe('planChunks', () => {
  const windowMs = 50;
  const env = (parts: [number, number][]) => {
    const out: number[] = [];
    for (const [ms, level] of parts) for (let i = 0; i < ms / windowMs; i++) out.push(level);
    return new Float32Array(out);
  };

  it('splits long audio at the quietest point before the limit', () => {
    const e = env([
      [20_000, 0.2],
      [500, 0.0001],
      [20_000, 0.2],
    ]);
    const chunks = planChunks(e, windowMs, 40_500, { maxMs: 28_000, searchMs: 10_000, silenceDb: -50 });
    expect(chunks.length).toBe(2);
    expect(chunks[0].start).toBe(0);
    expect(chunks[0].end).toBeGreaterThanOrEqual(20_000);
    expect(chunks[0].end).toBeLessThanOrEqual(20_500);
    expect(chunks[1]).toEqual({ start: chunks[0].end, end: 40_500 });
  });

  it('never exceeds the chunk limit and covers the whole recording', () => {
    const chunks = planChunks(env([[100_000, 0.2]]), windowMs, 100_000, { maxMs: 28_000, searchMs: 10_000, silenceDb: -50 });
    for (const c of chunks) expect(c.end - c.start).toBeLessThanOrEqual(28_000);
    expect(chunks[chunks.length - 1].end).toBe(100_000);
  });

  it('skips silent chunks', () => {
    const e = env([
      [10_000, 0.2],
      [30_000, 0.0001],
      [10_000, 0.2],
    ]);
    const chunks = planChunks(e, windowMs, 50_000, { maxMs: 28_000, searchMs: 10_000, silenceDb: -50 });
    for (const c of chunks) {
      const speech = c.start < 10_000 || c.end > 40_000;
      expect(speech).toBe(true);
    }
  });
});

describe('speech audio resampling', () => {
  it('downmixes to mono and resamples to the target rate at the right offset', () => {
    const targetRate = 16_000;
    const sums = new Float32Array(targetRate * 2);
    const counts = new Uint8Array(targetRate * 2);
    const left = new Float32Array(48_000).fill(0.6);
    const right = new Float32Array(48_000).fill(0.2);
    accumulateMono(sums, counts, [left, right], 48_000, 0.5, targetRate);
    const mono = finishMono(sums, counts);
    expect(mono[0]).toBe(0);
    expect(mono[8000 + 10]).toBeCloseTo(0.4);
    expect(mono[8000 + 15_990]).toBeCloseTo(0.4);
    expect(mono[24_000 + 10]).toBe(0);
  });
});
