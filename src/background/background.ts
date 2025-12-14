/**
 * Background service worker for Qamrec Screen Recorder
 * Handles extension lifecycle and message routing
 */

import type { ExtensionMessage, RecordingStatus, RecordingMode } from '../types';

// Current recording state
let recordingStatus: RecordingStatus = { state: 'idle' };
let recorderWindowId: number | null = null;

/**
 * Handle messages from popup and content scripts
 */
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'GET_STATUS':
      sendResponse(recordingStatus);
      break;

    case 'OPEN_RECORDER':
      openRecorderWindow(message.payload?.mode || 'screen', message.payload);
      sendResponse({ success: true });
      break;

    case 'START_RECORDING':
      recordingStatus = {
        state: 'recording',
        mode: message.payload?.mode,
        startTime: Date.now(),
      };
      sendResponse({ success: true });
      break;

    case 'STOP_RECORDING':
      recordingStatus = { state: 'stopped' };
      recorderWindowId = null;
      sendResponse({ success: true });
      break;

    case 'PAUSE_RECORDING':
      if (recordingStatus.state === 'recording') {
        recordingStatus.state = 'paused';
      }
      sendResponse({ success: true });
      break;

    case 'RESUME_RECORDING':
      if (recordingStatus.state === 'paused') {
        recordingStatus.state = 'recording';
      }
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ error: 'Unknown message type' });
  }

  return true; // Keep the message channel open for async responses
});

/**
 * Open the recorder page in a floating window
 */
async function openRecorderWindow(
  mode: RecordingMode,
  options?: ExtensionMessage['payload']
) {
  // Close existing recorder window if open
  if (recorderWindowId !== null) {
    try {
      await chrome.windows.remove(recorderWindowId);
    } catch {
      // Window might already be closed
    }
  }

  // Build URL with query params
  const params = new URLSearchParams({
    mode,
    audio: String(options?.includeAudio ?? true),
    mic: String(options?.includeMicrophone ?? false),
  });

  const recorderUrl = chrome.runtime.getURL(`recorder.html?${params}`);

  // Create floating window (doesn't close on blur like popup)
  const window = await chrome.windows.create({
    url: recorderUrl,
    type: 'popup',
    width: 760,
    height: 570,
    focused: true,
  });

  recorderWindowId = window.id ?? null;
}

/**
 * Handle window removal (cleanup)
 */
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === recorderWindowId) {
    recorderWindowId = null;
    if (recordingStatus.state === 'recording' || recordingStatus.state === 'paused') {
      recordingStatus = { state: 'idle' };
    }
  }
});

/**
 * Extension install/update handler
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Qamrec Screen Recorder installed!');
  } else if (details.reason === 'update') {
    console.log('Qamrec Screen Recorder updated to version', chrome.runtime.getManifest().version);
  }
});

// Log service worker activation
console.log('Qamrec background service worker started');
