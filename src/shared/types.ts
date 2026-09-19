/**
 * Shared types for Qamrec.
 *
 * Time conventions:
 * - "source time" is milliseconds on the recording's own timeline (pauses excluded),
 *   which is also the timeline of the recorded media file.
 * - "output time" is milliseconds on the edited timeline (after cuts).
 *
 * Space conventions:
 * - Normalized coordinates (0..1) are relative to the captured video frame.
 */

/** What is being captured */
export type CaptureSource = 'screen' | 'tab' | 'camera';

/** The surface the user actually picked (resolved after capture starts) */
export type CaptureSurface = 'monitor' | 'window' | 'browser' | 'tab' | 'camera';

export interface ScheduleOptions {
  /** Epoch ms at which recording should start, or null to start immediately */
  startAt: number | null;
  /** Automatically stop after this many minutes, or null for no limit */
  stopAfterMin: number | null;
}

export interface RecordingOptions {
  source: CaptureSource;
  /** Record a webcam overlay alongside the screen (ignored for camera source) */
  webcam: boolean;
  systemAudio: boolean;
  microphone: boolean;
  noiseReduction: boolean;
  /** Countdown seconds before recording starts (0 = none) */
  countdown: number;
  schedule: ScheduleOptions;
  tutorialMode: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Browser viewport geometry reported by the page tracker (CSS pixels) */
export interface ViewportInfo {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  screenX: number;
  screenY: number;
  screenWidth: number;
  screenHeight: number;
  screenLeft: number;
  screenTop: number;
  dpr: number;
  title: string;
}

/** Messages sent from the page tracker (content script) to the recorder. Coordinates are viewport CSS px. */
export type TrackerMessage =
  | { type: 'viewport'; vp: ViewportInfo }
  | { type: 'move'; x: number; y: number; at: number }
  | { type: 'click'; x: number; y: number; at: number }
  | { type: 'key'; label: string; at: number }
  | { type: 'typing'; rect: Rect | null; at: number }
  | { type: 'focus'; rect: Rect; at: number }
  | { type: 'scroll'; dy: number; at: number }
  | { type: 'visibility'; visible: boolean; at: number };

/** Messages sent from the recorder to the page tracker */
export type TrackerControl = { type: 'state'; active: boolean };

/** Events on the recording timeline, in source time and normalized video coordinates */
export type TimelineEvent =
  | { t: number; type: 'move'; x: number; y: number }
  | { t: number; type: 'click'; x: number; y: number }
  | { t: number; type: 'key'; label: string }
  | { t: number; type: 'typing'; rect: Rect | null }
  | { t: number; type: 'focus'; rect: Rect }
  | { t: number; type: 'scroll'; dy: number }
  | { t: number; type: 'page'; title: string }
  | { t: number; type: 'marker' };

export interface Range {
  start: number;
  end: number;
}

export interface ZoomRegion extends Range {
  id: string;
  /** Zoom scale (1 = no zoom) */
  scale: number;
  /** Fixed focus point (normalized), or null to follow the cursor */
  focus: Point | null;
  source: 'auto' | 'manual';
}

export interface Chapter {
  t: number;
  title: string;
}

/* ------------------------------------------------------------------ */
/* Effect / edit settings                                              */
/* ------------------------------------------------------------------ */

export interface ZoomSettings {
  auto: boolean;
  /** Zoom scale for automatic zooms (1.25 - 3) */
  intensity: number;
  /** How long a zoom holds after the last action, ms */
  duration: number;
  /** Zoom in/out transition time, ms */
  transitionMs: number;
  followCursor: boolean;
  typingFocus: boolean;
}

export interface CursorSettings {
  highlight: boolean;
  highlightColor: string;
  /** Highlight radius in px at 1080p output */
  highlightSize: number;
  clickRipples: boolean;
  rippleColor: string;
  /** Numbered click badges (tutorial mode) */
  clickIndicators: boolean;
  scrollIndicator: boolean;
}

export interface KeystrokeSettings {
  enabled: boolean;
  position: 'bottom' | 'top';
}

export type WebcamShape = 'circle' | 'rounded' | 'square' | 'rectangle';

export interface WebcamSettings {
  visible: boolean;
  shape: WebcamShape;
  /** Bubble height as a fraction of output height */
  size: number;
  /** Bubble center, normalized to output frame */
  x: number;
  y: number;
  /** Crop zoom into the camera image (1 = no crop) */
  cropZoom: number;
  /** Crop pan, -1..1 */
  cropX: number;
  cropY: number;
  mirror: boolean;
  borderWidth: number;
  borderColor: string;
  shadow: boolean;
  backgroundBlur: boolean;
  /** Blur radius in px */
  blurAmount: number;
}

export interface FrameSettings {
  /** Padding around the screen as a fraction of output size (0 = full bleed) */
  padding: number;
  background: string;
  cornerRadius: number;
  shadow: boolean;
  chapterTitles: boolean;
}

export type ExportFormat = 'mp4' | 'webm' | 'gif';
export type ExportResolution = 'original' | 2160 | 1440 | 1080 | 720 | 480;

export interface ExportSettings {
  format: ExportFormat;
  resolution: ExportResolution;
  fps: number;
  filenameTemplate: string;
}

export interface EffectsSettings {
  zoom: ZoomSettings;
  cursor: CursorSettings;
  keys: KeystrokeSettings;
  webcam: WebcamSettings;
  frame: FrameSettings;
  export: ExportSettings;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface Preset {
  id: string;
  name: string;
  builtin: boolean;
  recording: Partial<RecordingOptions>;
  effects: DeepPartial<EffectsSettings>;
}

/* ------------------------------------------------------------------ */
/* Runtime messaging                                                   */
/* ------------------------------------------------------------------ */

export type RecordingState = 'idle' | 'armed' | 'recording' | 'paused' | 'editing';

export interface RecordingStatus {
  state: RecordingState;
  /** Active recording ms at `updatedAt` */
  elapsed: number;
  /** Epoch ms when `elapsed` was measured */
  updatedAt: number;
}

export type ControlCommand = 'pause' | 'resume' | 'stop' | 'toggle-pause' | 'marker';

export type ExtensionMessage =
  | { type: 'OPEN_RECORDER'; options: RecordingOptions; tabId: number | null }
  | { type: 'GET_STATUS' }
  | { type: 'STATUS'; status: RecordingStatus }
  | { type: 'INJECT_TRACKER' }
  | { type: 'CONTROL'; command: ControlCommand }
  | { type: 'RECORDING_STARTED'; minimize: boolean }
  | { type: 'RECORDING_STOPPED' };
