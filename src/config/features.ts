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
  /** Enable screen recording mode */
  SCREEN_RECORDING: true,

  /** Enable camera-only recording mode */
  CAMERA_RECORDING: true,

  /** Enable screen + camera (picture-in-picture) mode */
  SCREEN_CAMERA: true,

  /** Enable system audio capture */
  SYSTEM_AUDIO: true,

  /** Enable MP4 export (requires FFmpeg.wasm) */
  MP4_EXPORT: false,

  /** Enable GIF export (requires FFmpeg.wasm) */
  GIF_EXPORT: false,

  /** Enable basic video trimming */
  BASIC_TRIM: false,

  /** Enable scheduled/timed recordings */
  SCHEDULED_RECORDING: false,
} as const;

export type FeatureKey = keyof typeof FEATURES;

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: FeatureKey): boolean {
  return FEATURES[feature];
}

/**
 * Get all enabled features
 */
export function getEnabledFeatures(): FeatureKey[] {
  return (Object.keys(FEATURES) as FeatureKey[]).filter(
    (key) => FEATURES[key]
  );
}
