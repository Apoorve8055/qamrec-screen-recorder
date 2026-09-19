import { describe, it, expect } from 'vitest';
import {
  normalizeRanges,
  keptSegments,
  outputDuration,
  sourceToOutput,
  outputToSource,
  addCut,
  removeCutAt,
  setTrim,
  getTrim,
  nextKeptTime,
} from './timeline';

describe('normalizeRanges', () => {
  it('sorts, clamps and merges overlapping ranges', () => {
    expect(
      normalizeRanges(
        [
          { start: 50, end: 70 },
          { start: -10, end: 10 },
          { start: 60, end: 80 },
          { start: 90, end: 200 },
          { start: 30, end: 30 },
        ],
        100
      )
    ).toEqual([
      { start: 0, end: 10 },
      { start: 50, end: 80 },
      { start: 90, end: 100 },
    ]);
  });
});

describe('kept segments and durations', () => {
  const cuts = [
    { start: 0, end: 1000 },
    { start: 4000, end: 5000 },
  ];

  it('lists what remains between cuts', () => {
    expect(keptSegments(10_000, cuts)).toEqual([
      { start: 1000, end: 4000 },
      { start: 5000, end: 10_000 },
    ]);
  });

  it('computes output duration', () => {
    expect(outputDuration(10_000, cuts)).toBe(8000);
    expect(outputDuration(10_000, [])).toBe(10_000);
  });

  it('maps source time to output time and back', () => {
    expect(sourceToOutput(1000, 10_000, cuts)).toBe(0);
    expect(sourceToOutput(3000, 10_000, cuts)).toBe(2000);
    expect(sourceToOutput(6000, 10_000, cuts)).toBe(4000);
    expect(sourceToOutput(4500, 10_000, cuts)).toBe(3000); // inside a cut -> where the cut sits

    expect(outputToSource(0, 10_000, cuts)).toBe(1000);
    expect(outputToSource(2000, 10_000, cuts)).toBe(3000);
    expect(outputToSource(3000, 10_000, cuts)).toBe(5000);
    expect(outputToSource(99_999, 10_000, cuts)).toBe(10_000);
  });

  it('skips over cuts during playback', () => {
    expect(nextKeptTime(4200, 10_000, cuts)).toBe(5000);
    expect(nextKeptTime(3000, 10_000, cuts)).toBe(3000);
    expect(nextKeptTime(500, 10_000, cuts)).toBe(1000);
  });
});

describe('editing cuts', () => {
  it('adds and merges cuts', () => {
    const cuts = addCut([{ start: 100, end: 200 }], { start: 150, end: 300 }, 1000);
    expect(cuts).toEqual([{ start: 100, end: 300 }]);
  });

  it('removes the cut containing a time', () => {
    const cuts = removeCutAt(
      [
        { start: 100, end: 200 },
        { start: 500, end: 600 },
      ],
      550
    );
    expect(cuts).toEqual([{ start: 100, end: 200 }]);
  });

  it('sets and reads trim handles without disturbing inner cuts', () => {
    const inner = [{ start: 400, end: 500 }];
    const cuts = setTrim(inner, 1000, 100, 900);
    expect(cuts).toEqual([
      { start: 0, end: 100 },
      { start: 400, end: 500 },
      { start: 900, end: 1000 },
    ]);
    expect(getTrim(cuts, 1000)).toEqual({ start: 100, end: 900 });

    const untrimmed = setTrim(cuts, 1000, 0, 1000);
    expect(untrimmed).toEqual(inner);
    expect(getTrim(untrimmed, 1000)).toEqual({ start: 0, end: 1000 });
  });
});
