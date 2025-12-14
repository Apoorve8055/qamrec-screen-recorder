import { useState, useEffect } from 'react';
import { isFeatureEnabled } from '../config/features';
import { ScreenIcon, CameraIcon, PipIcon, GithubIcon, GlobeIcon } from '../components/Icons';
import { formatDuration } from '../utils/format';
import { checkPermission, requestCameraPermission, requestMicrophonePermission } from '../utils/permissions';
import type { RecordingMode, RecordingStatus } from '../types';

export function Popup() {
  const [status, setStatus] = useState<RecordingStatus>({ state: 'idle' });
  const [includeAudio, setIncludeAudio] = useState(true);
  const [includeMic, setIncludeMic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
      if (response) {
        setStatus(response);
      }
    });
  }, []);

  const handleStartRecording = async (mode: RecordingMode) => {
    setError(null);
    setIsRequesting(true);

    try {
      // Determine required permissions based on mode and options
      const needsCamera = mode === 'camera' || mode === 'screen-camera';
      const needsMic = includeMic || (mode === 'camera' && includeAudio);

      // Check and request camera permission if needed
      if (needsCamera) {
        const cameraGranted = await checkPermission('camera');
        if (!cameraGranted) {
          const granted = await requestCameraPermission();
          if (!granted) {
            setError('Camera permission denied');
            setIsRequesting(false);
            return;
          }
        }
      }

      // Check and request microphone permission if needed
      if (needsMic) {
        const micGranted = await checkPermission('microphone');
        if (!micGranted) {
          const granted = await requestMicrophonePermission();
          if (!granted) {
            setError('Microphone permission denied');
            setIsRequesting(false);
            return;
          }
        }
      }

      // All permissions granted - open recorder
      chrome.runtime.sendMessage({
        type: 'OPEN_RECORDER',
        payload: {
          mode,
          includeAudio,
          includeMicrophone: includeMic,
        },
      });
      window.close();
    } catch {
      setError('Failed to request permissions');
      setIsRequesting(false);
    }
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

      {/* Error display */}
      {error && (
        <div className="mb-4 p-3 bg-red-600/20 border border-red-600 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

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
                disabled={isRequesting}
              />
            )}

            {isFeatureEnabled('CAMERA_RECORDING') && (
              <RecordButton
                icon={<CameraIcon />}
                label="Record Camera"
                description="Record from your webcam"
                onClick={() => handleStartRecording('camera')}
                disabled={isRequesting}
              />
            )}

            {isFeatureEnabled('SCREEN_CAMERA') && (
              <RecordButton
                icon={<PipIcon />}
                label="Screen + Camera"
                description="Screen with camera overlay"
                onClick={() => handleStartRecording('screen-camera')}
                disabled={isRequesting}
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
      <div className="mt-6 pt-4 border-t border-gray-700">
        <p className="text-xs text-gray-500 text-center mb-3">
          All recordings are saved locally. No data leaves your device.
        </p>
        <div className="flex items-center justify-center gap-4 text-xs text-gray-400">
          <span>by Apoorve Verma</span>
          <a
            href="https://github.com/Apoorve8055/qamrec-screen-recorder"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-white transition-colors"
          >
            <GithubIcon className="w-3.5 h-3.5" />
            GitHub
          </a>
          <a
            href="https://www.apoorveverma.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-white transition-colors"
          >
            <GlobeIcon className="w-3.5 h-3.5" />
            Website
          </a>
        </div>
      </div>
    </div>
  );
}

interface RecordButtonProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}

function RecordButton({ icon, label, description, onClick, disabled = false }: RecordButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 p-3 rounded-lg bg-gray-800 transition-colors text-left group focus-ring ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-700'
      }`}
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
