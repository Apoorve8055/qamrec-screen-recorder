/**
 * Feature flags for the Qamrec Screen Recorder extension.
 * Toggle features on/off at build time by changing these values.
 *
 * RULES:
 * - NO feature logic may bypass this file
 * - UI, permissions, and logic must respect feature flags
 * - Features must be toggleable at build time
 */
export const FEATURES = {
  /** Enable screen / window / tab recording via the screen picker */
  SCREEN_RECORDING: true,

  /** Enable one-click recording of the current tab (with page tracking) */
  TAB_RECORDING: true,

  /** Enable camera-only recording mode */
  CAMERA_RECORDING: true,

  /** Enable webcam overlay (picture-in-picture) on screen/tab recordings */
  SCREEN_CAMERA: true,

  /** Enable system/tab audio capture */
  SYSTEM_AUDIO: true,

  /** Enable click/typing/cursor tracking in the recorded tab (cinematic effects) */
  PAGE_TRACKING: true,

  /** Enable webcam background blur (bundles MediaPipe, ~12 MB) */
  BACKGROUND_BLUR: true,

  /** Enable MP4 export (WebCodecs) */
  MP4_EXPORT: true,

  /** Enable GIF export */
  GIF_EXPORT: true,

  /** Enable trim & cut editing */
  BASIC_TRIM: true,

  /** Enable automatic silence removal */
  SILENCE_REMOVAL: true,

  /** Enable subtitles: on-device speech-to-text (Whisper), editing, SRT/VTT import & export */
  SUBTITLES: true,

  /** Enable scheduled/timed recordings */
  SCHEDULED_RECORDING: true,

  /** Enable recording presets */
  PRESETS: true,
} as const;

export type FeatureKey = keyof typeof FEATURES;

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: FeatureKey): boolean {
  return FEATURES[feature];
}
