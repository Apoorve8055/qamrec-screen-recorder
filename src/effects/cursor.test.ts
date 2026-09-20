import { describe, it, expect } from 'vitest';
import { cursorAt, activeClicks, typingFocusAt, scrollActivityAt, visibleKeystrokes } from './cursor';

const moves = [
  { t: 1000, x: 0.1, y: 0.1 },
  { t: 1100, x: 0.3, y: 0.1 },
  { t: 5000, x: 0.9, y: 0.9 },
];

describe('cursorAt', () => {
  it('is unknown before the first sample', () => {
    expect(cursorAt(moves, 500)).toBeNull();
  });

  it('interpolates between close samples', () => {
    const p = cursorAt(moves, 1050)!;
    expect(p.x).toBeCloseTo(0.2);
  });

  it('holds position across long gaps instead of drifting', () => {
    expect(cursorAt(moves, 3000)).toEqual({ x: 0.3, y: 0.1 });
  });

  it('does not streak toward an off-surface marker', () => {
    const withMarker = [
      { t: 1000, x: 0.8, y: 0.8 },
      { t: 1100, x: -1, y: -1 },
    ];
    expect(cursorAt(withMarker, 1050)).toEqual({ x: 0.8, y: 0.8 });
  });

  it('holds the last known position', () => {
    expect(cursorAt(moves, 9000)).toEqual({ x: 0.9, y: 0.9 });
  });
});

describe('activeClicks', () => {
  const clicks = [
    { t: 1000, x: 0.5, y: 0.5 },
    { t: 3000, x: 0.2, y: 0.2 },
  ];

  it('reports clicks animating at a time with progress and step number', () => {
    expect(activeClicks(clicks, 1300, 600)).toEqual([{ x: 0.5, y: 0.5, progress: 0.5, step: 1 }]);
    expect(activeClicks(clicks, 3000, 600)).toEqual([{ x: 0.2, y: 0.2, progress: 0, step: 2 }]);
    expect(activeClicks(clicks, 2000, 600)).toEqual([]);
  });
});

describe('typingFocusAt', () => {
  it('returns the latest typing target while typing is recent', () => {
    const typing = [
      { t: 1000, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
      { t: 1500, rect: null },
    ];
    expect(typingFocusAt(typing, 1600, 1000)).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
    expect(typingFocusAt(typing, 5000, 1000)).toBeNull();
    expect(typingFocusAt(typing, 500, 1000)).toBeNull();
  });
});

describe('scrollActivityAt', () => {
  it('reports recent scroll direction with fading strength', () => {
    const scrolls = [{ t: 1000, dy: 200 }];
    expect(scrollActivityAt(scrolls, 1000, 800)).toEqual({ direction: 1, strength: 1 });
    expect(scrollActivityAt(scrolls, 1400, 800)!.strength).toBeCloseTo(0.5);
    expect(scrollActivityAt(scrolls, 2000, 800)).toBeNull();
    expect(scrollActivityAt([{ t: 1000, dy: -5 }], 1000, 800)!.direction).toBe(-1);
  });
});

describe('visibleKeystrokes', () => {
  const opts = { holdMs: 1500, fadeMs: 500, chainGapMs: 1000, maxItems: 3 };

  it('shows nothing before any key', () => {
    expect(visibleKeystrokes([{ t: 1000, label: 'A' }], 500, opts)).toBeNull();
  });

  it('chains keys pressed in quick succession and collapses repeats', () => {
    const keys = [
      { t: 1000, label: 'Ctrl + C' },
      { t: 1400, label: 'Ctrl + V' },
      { t: 1600, label: 'Ctrl + V' },
    ];
    expect(visibleKeystrokes(keys, 1700, opts)).toEqual({ labels: ['Ctrl + C', 'Ctrl + V ×2'], opacity: 1 });
  });

  it('starts a new chain after a pause', () => {
    const keys = [
      { t: 1000, label: 'A' },
      { t: 3000, label: 'B' },
    ];
    expect(visibleKeystrokes(keys, 3100, opts)!.labels).toEqual(['B']);
  });

  it('fades out after the hold', () => {
    const keys = [{ t: 1000, label: 'Enter' }];
    expect(visibleKeystrokes(keys, 2750, opts)!.opacity).toBeCloseTo(0.5);
    expect(visibleKeystrokes(keys, 4000, opts)).toBeNull();
  });

  it('limits how many keys are shown', () => {
    const keys = ['A', 'B', 'C', 'D'].map((label, i) => ({ t: 1000 + i * 100, label }));
    expect(visibleKeystrokes(keys, 1400, opts)!.labels).toEqual(['B', 'C', 'D']);
  });
});
