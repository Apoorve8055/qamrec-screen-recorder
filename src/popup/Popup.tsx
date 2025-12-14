import { useState, useEffect } from 'react';
import { isFeatureEnabled } from '../config/features';
import type { RecordingMode, RecordingStatus } from '../types';

export function Popup() {
  const [status, setStatus] = useState<RecordingStatus>({ state: 'idle' });
  const [includeAudio, setIncludeAudio] = useState(true);
  const [includeMic, setIncludeMic] = useState(false);

  useEffect(() => {
    // Get current recording status on mount
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
      if (response) {
        setStatus(response);
      }
    });
  }, []);

  const handleStartRecording = (mode: RecordingMode) => {
    chrome.runtime.sendMessage({
      type: 'OPEN_RECORDER',
      payload: {
        mode,
        includeAudio,
        includeMicrophone: includeMic,
      },
    });
    window.close();
  };

  const isRecording = status.state === 'recording' || status.state === 'paused';

  return (
    <div className="p-4 bg-gray-900 min-h-[400px]">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-white">Qamrec</h1>
        </div>
        <p className="text-gray-400 text-sm">Screen Recorder</p>
      </div>

      {isRecording ? (
        <RecordingInProgress status={status} />
      ) : (
        <>
          {/* Recording Mode Buttons */}
          <div className="space-y-3 mb-6">
            {isFeatureEnabled('SCREEN_RECORDING') && (
              <RecordButton
                icon={<ScreenIcon />}
                label="Record Screen"
                description="Capture your entire screen or a window"
                onClick={() => handleStartRecording('screen')}
              />
            )}

            {isFeatureEnabled('CAMERA_RECORDING') && (
              <RecordButton
                icon={<CameraIcon />}
                label="Record Camera"
                description="Record from your webcam"
                onClick={() => handleStartRecording('camera')}
              />
            )}

            {isFeatureEnabled('SCREEN_CAMERA') && (
              <RecordButton
                icon={<PipIcon />}
                label="Screen + Camera"
                description="Screen with camera overlay"
                onClick={() => handleStartRecording('screen-camera')}
              />
            )}
          </div>

          {/* Audio Options */}
          {isFeatureEnabled('SYSTEM_AUDIO') && (
            <div className="border-t border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Audio Options</h3>
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeAudio}
                    onChange={(e) => setIncludeAudio(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-primary-500 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-300">System audio</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeMic}
                    onChange={(e) => setIncludeMic(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-primary-500 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-300">Microphone</span>
                </label>
              </div>
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-gray-700 text-center">
        <p className="text-xs text-gray-500">
          All recordings are saved locally. No data leaves your device.
        </p>
      </div>
    </div>
  );
}

interface RecordButtonProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}

function RecordButton({ icon, label, description, onClick }: RecordButtonProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-left group focus-ring"
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white group-hover:bg-primary-500 transition-colors">
        {icon}
      </div>
      <div>
        <div className="font-medium text-white">{label}</div>
        <div className="text-xs text-gray-400">{description}</div>
      </div>
    </button>
  );
}

function RecordingInProgress({ status }: { status: RecordingStatus }) {
  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const duration = status.startTime ? Date.now() - status.startTime : 0;

  return (
    <div className="text-center py-8">
      <div className="w-16 h-16 rounded-full bg-red-600 mx-auto mb-4 flex items-center justify-center recording-pulse">
        <div className="w-6 h-6 rounded-sm bg-white" />
      </div>
      <h2 className="text-lg font-medium text-white mb-2">
        {status.state === 'paused' ? 'Paused' : 'Recording...'}
      </h2>
      <p className="text-2xl font-mono text-primary-400 mb-4">
        {formatDuration(duration)}
      </p>
      <p className="text-sm text-gray-400">
        Recording controls are in the recorder tab
      </p>
    </div>
  );
}

// Icons
function ScreenIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function PipIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10m-10 4h6m4-4h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3a1 1 0 011-1z" />
    </svg>
  );
}
