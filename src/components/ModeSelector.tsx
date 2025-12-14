import React from 'react';
import { FEATURES, isFeatureEnabled } from '../config/features';
import type { RecordingMode } from '../types';

interface ModeSelectorProps {
  selectedMode: RecordingMode;
  onModeChange: (mode: RecordingMode) => void;
  disabled?: boolean;
}

export function ModeSelector({
  selectedMode,
  onModeChange,
  disabled = false,
}: ModeSelectorProps) {
  const modes: { mode: RecordingMode; label: string; icon: React.ReactNode; feature: keyof typeof FEATURES }[] = [
    {
      mode: 'screen',
      label: 'Screen',
      icon: <ScreenIcon />,
      feature: 'SCREEN_RECORDING',
    },
    {
      mode: 'camera',
      label: 'Camera',
      icon: <CameraIcon />,
      feature: 'CAMERA_RECORDING',
    },
    {
      mode: 'screen-camera',
      label: 'Screen + Camera',
      icon: <PipIcon />,
      feature: 'SCREEN_CAMERA',
    },
  ];

  const availableModes = modes.filter((m) => isFeatureEnabled(m.feature));

  return (
    <div className="flex gap-2">
      {availableModes.map(({ mode, label, icon }) => (
        <button
          key={mode}
          onClick={() => onModeChange(mode)}
          disabled={disabled}
          className={`
            flex-1 flex flex-col items-center gap-2 p-3 rounded-lg
            transition-all duration-200 focus-ring
            ${
              selectedMode === mode
                ? 'bg-primary-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <div className="w-8 h-8 flex items-center justify-center">
            {icon}
          </div>
          <span className="text-xs font-medium">{label}</span>
        </button>
      ))}
    </div>
  );
}

function ScreenIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function PipIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 10h16M4 14h10m-10 4h6m4-4h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3a1 1 0 011-1z"
      />
    </svg>
  );
}
