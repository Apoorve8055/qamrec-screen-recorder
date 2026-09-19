import type { DeepPartial, EffectsSettings, Preset, RecordingOptions } from './types';

export const DEFAULT_RECORDING: RecordingOptions = {
  source: 'screen',
  webcam: false,
  systemAudio: true,
  microphone: false,
  noiseReduction: true,
  countdown: 3,
  schedule: { startAt: null, stopAfterMin: null },
  tutorialMode: false,
};

export const DEFAULT_EFFECTS: EffectsSettings = {
  zoom: {
    auto: true,
    intensity: 1.8,
    duration: 2500,
    transitionMs: 700,
    followCursor: true,
    typingFocus: true,
  },
  cursor: {
    highlight: true,
    highlightColor: '#facc15',
    highlightSize: 28,
    clickRipples: true,
    rippleColor: '#ffffff',
    clickIndicators: false,
    scrollIndicator: true,
  },
  keys: { enabled: true, position: 'bottom' },
  webcam: {
    visible: true,
    shape: 'circle',
    size: 0.26,
    x: 0.86,
    y: 0.78,
    cropZoom: 1,
    cropX: 0,
    cropY: 0,
    mirror: true,
    borderWidth: 4,
    borderColor: '#ffffff',
    shadow: true,
    backgroundBlur: false,
    blurAmount: 14,
  },
  frame: {
    padding: 0.05,
    background: 'aurora',
    cornerRadius: 14,
    shadow: true,
    chapterTitles: false,
  },
  export: {
    format: 'mp4',
    resolution: 1080,
    fps: 30,
    filenameTemplate: 'qamrec-{date}_{time}',
  },
};

export const BUILTIN_PRESETS: Preset[] = [
  { id: 'default', name: 'Default', builtin: true, recording: {}, effects: {} },
  {
    id: 'cinematic',
    name: 'Cinematic',
    builtin: true,
    recording: {},
    effects: {
      zoom: { intensity: 2.1, transitionMs: 900, duration: 3000 },
      frame: { padding: 0.07, background: 'aurora', cornerRadius: 18, shadow: true, chapterTitles: true },
    },
  },
  {
    id: 'tutorial',
    name: 'Tutorial',
    builtin: true,
    recording: { tutorialMode: true, microphone: true },
    effects: {
      zoom: { intensity: 1.8, duration: 3200 },
      cursor: { highlight: true, clickIndicators: true, clickRipples: true },
      keys: { enabled: true },
      frame: { chapterTitles: true },
    },
  },
  {
    id: 'minimal',
    name: 'Clean capture',
    builtin: true,
    recording: {},
    effects: {
      zoom: { auto: false },
      cursor: { highlight: false, clickRipples: false, clickIndicators: false, scrollIndicator: false },
      keys: { enabled: false },
      frame: { padding: 0, cornerRadius: 0, shadow: false },
    },
  },
  {
    id: 'gif',
    name: 'Quick GIF',
    builtin: true,
    recording: {},
    effects: {
      export: { format: 'gif', resolution: 480, fps: 12 },
      frame: { padding: 0 },
    },
  },
  {
    id: 'talking-head',
    name: 'Talking head',
    builtin: true,
    recording: { webcam: true, microphone: true },
    effects: {
      webcam: { shape: 'rounded', size: 0.38, x: 0.8, y: 0.72, backgroundBlur: true },
    },
  },
];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value;
  }
  return out as T;
}

export function applyPreset(
  recording: RecordingOptions,
  effects: EffectsSettings,
  preset: Preset
): { recording: RecordingOptions; effects: EffectsSettings } {
  return {
    recording: deepMerge(recording, preset.recording as DeepPartial<RecordingOptions>),
    effects: deepMerge(effects, preset.effects),
  };
}

const TUTORIAL_OVERRIDES = {
  cursor: { highlight: true, clickIndicators: true, clickRipples: true },
  keys: { enabled: true },
};

/** Tutorial mode turns on the overlays that make steps easy to follow */
export function effectsForRecording(effects: EffectsSettings, recording: RecordingOptions): EffectsSettings {
  if (!recording.tutorialMode) return effects;
  return deepMerge(effects, TUTORIAL_OVERRIDES);
}

/**
 * The look to remember as the default: tutorial-mode overrides are per-recording,
 * so they are reverted to the user's base values before saving.
 */
export function persistableEffects(
  effects: EffectsSettings,
  base: EffectsSettings,
  recording: RecordingOptions
): EffectsSettings {
  if (!recording.tutorialMode) return effects;
  return deepMerge(effects, {
    cursor: {
      highlight: base.cursor.highlight,
      clickIndicators: base.cursor.clickIndicators,
      clickRipples: base.cursor.clickRipples,
    },
    keys: { enabled: base.keys.enabled },
  });
}
