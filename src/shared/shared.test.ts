import { describe, it, expect } from 'vitest';
import { deepMerge, applyPreset, effectsForRecording, persistableEffects, DEFAULT_EFFECTS, DEFAULT_RECORDING, BUILTIN_PRESETS } from './settings';
import { buildFilename } from './filename';
import { outputSize } from './resolution';

describe('deepMerge', () => {
  it('merges nested partials without mutating the base', () => {
    const base = { a: 1, nested: { b: 2, c: 3 } };
    const merged = deepMerge(base, { nested: { c: 9 } });
    expect(merged).toEqual({ a: 1, nested: { b: 2, c: 9 } });
    expect(base.nested.c).toBe(3);
  });

  it('ignores undefined values', () => {
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
  });
});

describe('presets', () => {
  it('applies a preset on top of defaults', () => {
    const gif = BUILTIN_PRESETS.find((p) => p.id === 'gif')!;
    const { recording, effects } = applyPreset(DEFAULT_RECORDING, DEFAULT_EFFECTS, gif);
    expect(effects.export.format).toBe('gif');
    expect(effects.zoom).toEqual(DEFAULT_EFFECTS.zoom);
    expect(recording).toEqual(DEFAULT_RECORDING);
  });

  it('has unique ids', () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('turns on tutorial overlays for tutorial-mode recordings', () => {
    const effects = effectsForRecording(DEFAULT_EFFECTS, { ...DEFAULT_RECORDING, tutorialMode: true });
    expect(effects.cursor.clickIndicators).toBe(true);
    expect(effects.cursor.highlight).toBe(true);
    expect(effects.keys.enabled).toBe(true);
    expect(effectsForRecording(DEFAULT_EFFECTS, DEFAULT_RECORDING)).toEqual(DEFAULT_EFFECTS);
  });

  it('does not save tutorial overlays as the default look', () => {
    const base = deepMerge(DEFAULT_EFFECTS, { cursor: { clickIndicators: false, highlight: false }, keys: { enabled: false } });
    const tutorial = { ...DEFAULT_RECORDING, tutorialMode: true };
    const edited = deepMerge(effectsForRecording(base, tutorial), { zoom: { intensity: 2.5 } });
    const saved = persistableEffects(edited, base, tutorial);
    expect(saved.cursor.clickIndicators).toBe(false);
    expect(saved.cursor.highlight).toBe(false);
    expect(saved.keys.enabled).toBe(false);
    expect(saved.zoom.intensity).toBe(2.5);
    expect(persistableEffects(edited, base, DEFAULT_RECORDING)).toEqual(edited);
  });
});

describe('buildFilename', () => {
  const ctx = {
    date: new Date(2026, 8, 19, 14, 5, 9),
    title: 'My Dashboard: Q3/Q4 *report*',
    mode: 'tab',
    durationMs: 65_000,
    resolution: '1080p',
    counter: 7,
  };

  it('fills in template tokens', () => {
    expect(buildFilename('qamrec-{date}_{time}', ctx, 'mp4')).toBe('qamrec-2026-09-19_14-05-09.mp4');
    expect(buildFilename('{n} {mode} {duration} {res}', ctx, 'gif')).toBe('007-tab-1m05s-1080p.gif');
  });

  it('strips characters that are illegal in filenames', () => {
    expect(buildFilename('{title}', ctx, 'webm')).toBe('My-Dashboard-Q3Q4-report.webm');
  });

  it('falls back to a default name when the result is empty', () => {
    expect(buildFilename('{title}', { ...ctx, title: '' }, 'mp4')).toBe('qamrec-recording.mp4');
    expect(buildFilename('***', ctx, 'mp4')).toBe('qamrec-recording.mp4');
  });

  it('drops unknown tokens', () => {
    expect(buildFilename('a{nope}b', ctx, 'mp4')).toBe('ab.mp4');
  });
});

describe('outputSize', () => {
  it('scales by height, keeping aspect ratio', () => {
    expect(outputSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize(2560, 1440, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it('never upscales', () => {
    expect(outputSize(1280, 720, 1080)).toEqual({ width: 1280, height: 720 });
  });

  it('keeps dimensions even for video encoders', () => {
    expect(outputSize(1366, 767, 'original')).toEqual({ width: 1366, height: 766 });
    const s = outputSize(1000, 750, 480);
    expect(s.width % 2).toBe(0);
    expect(s.height).toBe(480);
  });
});
