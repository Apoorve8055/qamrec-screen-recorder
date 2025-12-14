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
  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  };

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

function PlayIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 6h12v12H6z" />
    </svg>
  );
}
