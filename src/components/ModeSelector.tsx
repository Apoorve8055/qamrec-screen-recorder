import React from 'react';
import { FEATURES, isFeatureEnabled } from '../config/features';
import { ScreenIcon, CameraIcon, PipIcon } from './Icons';
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
      icon: <ScreenIcon className="w-6 h-6" />,
      feature: 'SCREEN_RECORDING',
    },
    {
      mode: 'camera',
      label: 'Camera',
      icon: <CameraIcon className="w-6 h-6" />,
      feature: 'CAMERA_RECORDING',
    },
    {
      mode: 'screen-camera',
      label: 'Screen + Camera',
      icon: <PipIcon className="w-6 h-6" />,
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
