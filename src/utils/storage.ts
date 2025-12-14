/**
 * Chrome storage utilities
 */

import type { RecordingOptions, PipConfig } from '../types';

/**
 * Storage keys
 */
export const STORAGE_KEYS = {
  LAST_MODE: 'lastRecordingMode',
  INCLUDE_SYSTEM_AUDIO: 'includeSystemAudio',
  INCLUDE_MICROPHONE: 'includeMicrophone',
  PIP_CONFIG: 'pipConfig',
  RECORDING_STATE: 'recordingState',
} as const;

type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

/**
 * Get a value from chrome.storage.local
 */
export async function getStorageValue<T>(key: StorageKey, defaultValue: T): Promise<T> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] !== undefined ? result[key] : defaultValue);
    });
  });
}

/**
 * Set a value in chrome.storage.local
 */
export async function setStorageValue<T>(key: StorageKey, value: T): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

/**
 * Get multiple values from chrome.storage.local
 */
export async function getStorageValues<T extends Record<string, unknown>>(
  keys: StorageKey[]
): Promise<Partial<T>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result as Partial<T>);
    });
  });
}

/**
 * Clear all extension storage
 */
export async function clearStorage(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.clear(resolve);
  });
}

/**
 * Save recording options to storage
 */
export async function saveRecordingOptions(options: Partial<RecordingOptions>): Promise<void> {
  const updates: Record<string, unknown> = {};

  if (options.mode !== undefined) {
    updates[STORAGE_KEYS.LAST_MODE] = options.mode;
  }
  if (options.includeSystemAudio !== undefined) {
    updates[STORAGE_KEYS.INCLUDE_SYSTEM_AUDIO] = options.includeSystemAudio;
  }
  if (options.includeMicrophone !== undefined) {
    updates[STORAGE_KEYS.INCLUDE_MICROPHONE] = options.includeMicrophone;
  }
  if (options.pipConfig !== undefined) {
    updates[STORAGE_KEYS.PIP_CONFIG] = options.pipConfig;
  }

  return new Promise((resolve) => {
    chrome.storage.local.set(updates, resolve);
  });
}

/**
 * Load recording options from storage
 */
export async function loadRecordingOptions(): Promise<RecordingOptions> {
  const result = await getStorageValues<{
    [STORAGE_KEYS.LAST_MODE]: RecordingOptions['mode'];
    [STORAGE_KEYS.INCLUDE_SYSTEM_AUDIO]: boolean;
    [STORAGE_KEYS.INCLUDE_MICROPHONE]: boolean;
    [STORAGE_KEYS.PIP_CONFIG]: PipConfig;
  }>([
    STORAGE_KEYS.LAST_MODE,
    STORAGE_KEYS.INCLUDE_SYSTEM_AUDIO,
    STORAGE_KEYS.INCLUDE_MICROPHONE,
    STORAGE_KEYS.PIP_CONFIG,
  ]);

  return {
    mode: result[STORAGE_KEYS.LAST_MODE] || 'screen',
    includeSystemAudio: result[STORAGE_KEYS.INCLUDE_SYSTEM_AUDIO] ?? true,
    includeMicrophone: result[STORAGE_KEYS.INCLUDE_MICROPHONE] ?? false,
    pipConfig: result[STORAGE_KEYS.PIP_CONFIG],
  };
}
