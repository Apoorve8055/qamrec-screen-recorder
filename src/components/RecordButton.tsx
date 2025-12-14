interface RecordButtonProps {
  onClick: () => void;
  isRecording?: boolean;
  isPaused?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function RecordButton({
  onClick,
  isRecording = false,
  isPaused = false,
  disabled = false,
  size = 'md',
}: RecordButtonProps) {
  const sizeClasses = {
    sm: 'w-12 h-12',
    md: 'w-16 h-16',
    lg: 'w-20 h-20',
  };

  const innerSizeClasses = {
    sm: isRecording ? 'w-4 h-4' : 'w-6 h-6',
    md: isRecording ? 'w-5 h-5' : 'w-8 h-8',
    lg: isRecording ? 'w-6 h-6' : 'w-10 h-10',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        ${sizeClasses[size]}
        rounded-full
        bg-red-600
        hover:bg-red-500
        disabled:bg-gray-600
        disabled:cursor-not-allowed
        flex items-center justify-center
        transition-all duration-200
        focus-ring
        ${isRecording && !isPaused ? 'recording-pulse' : ''}
      `}
      title={isRecording ? (isPaused ? 'Paused' : 'Recording...') : 'Start Recording'}
    >
      <div
        className={`
          ${innerSizeClasses[size]}
          ${isRecording ? 'rounded-sm' : 'rounded-full'}
          bg-white
          transition-all duration-200
        `}
      />
    </button>
  );
}
