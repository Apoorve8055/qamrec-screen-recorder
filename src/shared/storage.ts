import { DEFAULT_EFFECTS, DEFAULT_RECORDING, deepMerge } from './settings';
import type { DeepPartial, EffectsSettings, Preset, RecordingOptions } from './types';

/**
 * Settings persisted in chrome.storage.local (on this device only).
 * Stored under a single key:
 *   qamrec: { recording, effects, userPresets, activePresetId, fileCounter }
 */
export interface StoredState {
  recording: RecordingOptions;
  effects: EffectsSettings;
  userPresets: Preset[];
  activePresetId: string;
  fileCounter: number;
}

const KEY = 'qamrec';

export async function loadState(): Promise<StoredState> {
  const raw = ((await chrome.storage.local.get(KEY))[KEY] ?? {}) as Partial<{
    recording: DeepPartial<RecordingOptions>;
    effects: DeepPartial<EffectsSettings>;
    userPresets: Preset[];
    activePresetId: string;
    fileCounter: number;
  }>;
  const recording = deepMerge(DEFAULT_RECORDING, raw.recording);
  return {
    // A scheduled start time never carries over between sessions
    recording: { ...recording, schedule: { ...recording.schedule, startAt: null } },
    effects: deepMerge(DEFAULT_EFFECTS, raw.effects),
    userPresets: raw.userPresets ?? [],
    activePresetId: raw.activePresetId ?? 'default',
    fileCounter: raw.fileCounter ?? 0,
  };
}

export async function saveState(patch: Partial<StoredState>): Promise<void> {
  const current = await loadState();
  await chrome.storage.local.set({ [KEY]: { ...current, ...patch } });
}

/** Increments and returns the {n} filename counter */
export async function nextFileCounter(): Promise<number> {
  const { fileCounter } = await loadState();
  const next = fileCounter + 1;
  await saveState({ fileCounter: next });
  return next;
}
