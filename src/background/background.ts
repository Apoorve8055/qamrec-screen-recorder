/**
 * Background service worker for Qamrec Screen Recorder
 * Handles extension lifecycle and message routing
 */

import type { ControlCommand, ExtensionMessage, RecordingOptions, RecordingStatus } from '../shared/types';

const RECORDER_SIZE = { width: 900, height: 640 };
const EDITOR_SIZE = { width: 1320, height: 880 };

/**
 * Worker state. MV3 service workers are shut down when idle (e.g. mid-recording),
 * so it is mirrored to chrome.storage.session and restored before handling any event.
 */
interface WorkerState {
  status: RecordingStatus;
  recorderWindowId: number | null;
  /** The tab the user invoked the extension on (activeTab grant): tracked and/or captured */
  targetTabId: number | null;
  targetWindowId: number | null;
}

const STATE_KEY = 'qamrecWorker';
const state: WorkerState = {
  status: { state: 'idle', elapsed: 0, updatedAt: Date.now() },
  recorderWindowId: null,
  targetTabId: null,
  targetWindowId: null,
};

const restored = chrome.storage.session
  .get(STATE_KEY)
  .then((r) => Object.assign(state, (r[STATE_KEY] as Partial<WorkerState>) ?? {}))
  .catch(() => state);

function persist(): Promise<void> {
  return chrome.storage.session.set({ [STATE_KEY]: state });
}

/**
 * Handle messages from popup, recorder and content scripts
 */
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  // CONTROL messages go straight from the popup to the recorder page
  if (message.type === 'CONTROL') return false;
  restored.then(() => handleMessage(message)).then(sendResponse, (err: Error) => sendResponse({ success: false, error: err.message }));
  return true; // async response
});

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'GET_STATUS':
      return state.status;

    case 'STATUS':
      state.status = message.status;
      await persist();
      updateBadge();
      return undefined;

    case 'OPEN_RECORDER':
      await openRecorder(message.options, message.tabId);
      return { success: true };

    case 'INJECT_TRACKER':
      return injectTracker();

    case 'RECORDING_STARTED':
      await onRecordingStarted(message.minimize);
      return undefined;

    case 'RECORDING_STOPPED':
      await onRecordingStopped();
      return undefined;

    default:
      return undefined;
  }
}

/**
 * Open the recorder page in a floating window (doesn't close on blur like the popup)
 */
async function openRecorder(options: RecordingOptions, tabId: number | null) {
  if (state.recorderWindowId !== null && ['armed', 'recording', 'paused'].includes(state.status.state)) {
    try {
      await chrome.windows.update(state.recorderWindowId, { focused: true, state: 'normal' });
      return;
    } catch {
      // The window is gone; start fresh
    }
  }

  state.targetTabId = tabId;
  state.targetWindowId = null;
  if (tabId !== null) {
    try {
      state.targetWindowId = (await chrome.tabs.get(tabId)).windowId;
    } catch {
      state.targetTabId = null;
    }
  }

  // Tab capture needs a stream id minted while the activeTab grant is fresh
  let streamId = '';
  if (options.source === 'tab') {
    const targetTabId = state.targetTabId;
    if (targetTabId === null) throw new Error('No tab to record');
    streamId = await new Promise<string>((resolve, reject) =>
      chrome.tabCapture.getMediaStreamId({ targetTabId }, (id) =>
        chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id)
      )
    );
  }

  const params = new URLSearchParams({ o: JSON.stringify(options), sid: streamId });
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(`recorder.html?${params}`),
    type: 'popup',
    ...RECORDER_SIZE,
    focused: true,
  });
  state.recorderWindowId = win.id ?? null;
  state.status = { state: 'armed', elapsed: 0, updatedAt: Date.now() };
  await persist();
  updateBadge();
}

async function injectTracker(): Promise<{ ok: boolean; error?: string }> {
  if (state.targetTabId === null) return { ok: false, error: 'No tab to track' };
  try {
    await chrome.scripting.executeScript({ target: { tabId: state.targetTabId }, files: ['tracker.js'] });
    return { ok: true };
  } catch (err) {
    // Chrome pages, the Web Store and PDF viewers can't be scripted
    return { ok: false, error: (err as Error).message };
  }
}

async function onRecordingStarted(minimize: boolean) {
  try {
    if (state.targetWindowId !== null) await chrome.windows.update(state.targetWindowId, { focused: true });
    if (state.targetTabId !== null) await chrome.tabs.update(state.targetTabId, { active: true });
    // A full-screen capture would otherwise record the recorder window itself
    if (minimize && state.recorderWindowId !== null) {
      await chrome.windows.update(state.recorderWindowId, { state: 'minimized' });
    }
  } catch {
    // Windows may have been closed meanwhile
  }
}

async function onRecordingStopped() {
  if (state.recorderWindowId === null) return;
  try {
    await chrome.windows.update(state.recorderWindowId, { state: 'normal' });
    await chrome.windows.update(state.recorderWindowId, { ...EDITOR_SIZE, focused: true });
  } catch {
    // Window closed
  }
}

function updateBadge() {
  const badge: Record<string, { text: string; color: string }> = {
    recording: { text: 'REC', color: '#dc2626' },
    paused: { text: '❚❚', color: '#ca8a04' },
    armed: { text: '•', color: '#6b7280' },
  };
  const b = badge[state.status.state];
  chrome.action.setBadgeText({ text: b?.text ?? '' });
  if (b) chrome.action.setBadgeBackgroundColor({ color: b.color });
}

/**
 * Keyboard shortcuts (chrome://extensions/shortcuts)
 */
chrome.commands.onCommand.addListener((command) => {
  const map: Record<string, ControlCommand> = {
    'stop-recording': 'stop',
    'toggle-pause': 'toggle-pause',
    'add-marker': 'marker',
  };
  const control = map[command];
  if (control) chrome.runtime.sendMessage({ type: 'CONTROL', command: control }).catch(() => {});
});

/**
 * Handle window removal (cleanup)
 */
chrome.windows.onRemoved.addListener(async (windowId) => {
  await restored;
  if (windowId === state.recorderWindowId) {
    state.recorderWindowId = null;
    state.status = { state: 'idle', elapsed: 0, updatedAt: Date.now() };
    await persist();
    updateBadge();
  }
});
