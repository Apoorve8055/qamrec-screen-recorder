/**
 * Recording modes supported by the extension
 */
export type RecordingMode = 'screen' | 'camera' | 'screen-camera';

/**
 * Recording state
 */
export type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';

/**
 * Message types for communication between popup and background
 */
export type MessageType =
  | 'START_RECORDING'
  | 'STOP_RECORDING'
  | 'PAUSE_RECORDING'
  | 'RESUME_RECORDING'
  | 'GET_STATUS'
  | 'OPEN_RECORDER';

/**
 * Message structure for runtime messaging
 */
export interface ExtensionMessage {
  type: MessageType;
  payload?: {
    mode?: RecordingMode;
    includeAudio?: boolean;
    includeMicrophone?: boolean;
  };
}

/**
 * Recording status response
 */
export interface RecordingStatus {
  state: RecordingState;
  mode?: RecordingMode;
  duration?: number;
  startTime?: number;
}

/**
 * Media stream configuration
 */
export interface StreamConfig {
  video: boolean | MediaTrackConstraints;
  audio: boolean | MediaTrackConstraints;
}

/**
 * PiP (Picture-in-Picture) overlay configuration
 */
export interface PipConfig {
  /** Overlay width in pixels */
  width: number;
  /** Overlay height in pixels */
  height: number;
  /** Position from right edge */
  offsetX: number;
  /** Position from bottom edge */
  offsetY: number;
  /** Border radius in pixels */
  borderRadius: number;
}

/**
 * Default PiP configuration
 */
export const DEFAULT_PIP_CONFIG: PipConfig = {
  width: 300,
  height: 300,
  offsetX: 20,
  offsetY: 20,
  borderRadius: 10,
};

/**
 * Recording options
 */
export interface RecordingOptions {
  mode: RecordingMode;
  includeSystemAudio: boolean;
  includeMicrophone: boolean;
  pipConfig?: PipConfig;
}
