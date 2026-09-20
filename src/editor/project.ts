import type {
  CaptureSource,
  CaptureSurface,
  Chapter,
  EffectsSettings,
  Range,
  SubtitleCue,
  TimelineEvent,
  ZoomRegion,
} from '../shared/types';
import type { ActivitySample } from '../effects/zoom';

/** Everything needed to render and edit one recording. Times are source ms. */
export interface Project {
  duration: number;
  mode: CaptureSource;
  surface: CaptureSurface;
  sourceWidth: number;
  sourceHeight: number;
  /** Webcam recording start relative to the main recording, or null without webcam */
  webcamOffsetMs: number | null;
  /** The main recording *is* the webcam (camera-only mode) */
  cameraOnly: boolean;
  title: string;
  events: TimelineEvent[];
  activity: ActivitySample[];
  cuts: Range[];
  manualZooms: ZoomRegion[];
  /** Automatic zooms the user deleted */
  suppressedZoomIds: string[];
  chapters: Chapter[];
  highlights: Range[];
  /** Subtitle cues, sorted by start */
  subtitles: SubtitleCue[];
  settings: EffectsSettings;
}

/** Whether the recording has pointer/keyboard events from the page tracker */
export function hasPointerTracking(project: Project): boolean {
  return project.events.some((e) => e.type === 'click' || e.type === 'move' || e.type === 'typing');
}
