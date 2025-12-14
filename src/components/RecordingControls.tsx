import { PlayIcon, PauseIcon, StopIcon } from './Icons';
import { formatDuration } from '../utils/format';

interface RecordingControlsProps {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function RecordingControls({
  isRecording,
  isPaused,
  duration,
  onPause,
  onResume,
  onStop,
}: RecordingControlsProps) {
  if (!isRecording && !isPaused) {
    return null;
  }

  return (
    <div className="flex items-center gap-4 bg-gray-800 p-4 rounded-lg">
      {/* Status indicator */}
      <div className="flex items-center gap-2">
        <div
          className={`w-3 h-3 rounded-full ${
            isPaused ? 'bg-yellow-500' : 'bg-red-500 recording-pulse'
          }`}
        />
        <span className="text-sm font-medium">
          {isPaused ? 'Paused' : 'Recording'}
        </span>
      </div>

      {/* Duration */}
      <div className="font-mono text-lg text-primary-400">
        {formatDuration(duration)}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 ml-auto">
        {isPaused ? (
          <button
            onClick={onResume}
            className="w-10 h-10 rounded-full bg-green-600 hover:bg-green-500 flex items-center justify-center transition-colors focus-ring"
            title="Resume"
          >
            <PlayIcon />
          </button>
        ) : (
          <button
            onClick={onPause}
            className="w-10 h-10 rounded-full bg-yellow-600 hover:bg-yellow-500 flex items-center justify-center transition-colors focus-ring"
            title="Pause"
          >
            <PauseIcon />
          </button>
        )}

        <button
          onClick={onStop}
          className="w-10 h-10 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-colors focus-ring"
          title="Stop"
        >
          <StopIcon />
        </button>
      </div>
    </div>
  );
}
