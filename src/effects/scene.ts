import type { Point, Rect, ZoomRegion } from '../shared/types';
import type { Project } from '../editor/project';
import { hasPointerTracking } from '../editor/project';
import { buildAutoZoomRegions, buildMotionZoomRegions, combineZoomRegions } from './zoom';
import { buildCameraPath, type CameraPath } from './camera';
import { cursorAt as cursorAtRaw, typingFocusAt } from './cursor';

/** Pan smoothing and cursor deadzone used for "smart action following" */
const CAMERA_SMOOTHING_MS = 160;
const CAMERA_DEADZONE = 0.55;
/** The path is computed offline, so the camera can anticipate where the cursor is going */
const FOLLOW_LOOKAHEAD_MS = 300;

/** A project with everything precomputed for fast per-frame rendering */
export interface Scene {
  project: Project;
  /** Automatic zooms before user deletions (shown dimmed in the timeline) */
  autoZooms: ZoomRegion[];
  /** Zooms actually applied */
  regions: ZoomRegion[];
  camera: CameraPath;
  moves: { t: number; x: number; y: number }[];
  clicks: { t: number; x: number; y: number }[];
  keys: { t: number; label: string }[];
  typing: { t: number; rect: Rect | null }[];
  scrolls: { t: number; dy: number }[];
  cursorAt: (t: number) => Point | null;
}

/** The recorder marks the pointer as off-surface (tab hidden) with negative coordinates */
const onSurface = (p: Point | null): Point | null =>
  p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? p : null;

export function buildScene(project: Project): Scene {
  const { events, settings, duration } = project;
  const moves: Scene['moves'] = [];
  const clicks: Scene['clicks'] = [];
  const keys: Scene['keys'] = [];
  const typing: Scene['typing'] = [];
  const scrolls: Scene['scrolls'] = [];

  for (const e of events) {
    switch (e.type) {
      case 'move':
        moves.push({ t: e.t, x: e.x, y: e.y });
        break;
      case 'click':
        moves.push({ t: e.t, x: e.x, y: e.y });
        clicks.push({ t: e.t, x: e.x, y: e.y });
        break;
      case 'key':
        keys.push({ t: e.t, label: e.label });
        break;
      case 'typing':
      case 'focus':
        typing.push({ t: e.t, rect: e.rect });
        break;
      case 'scroll':
        scrolls.push({ t: e.t, dy: e.dy });
        break;
    }
  }

  const cursorAt = (t: number) => onSurface(cursorAtRaw(moves, t));

  let autoZooms: ZoomRegion[] = [];
  if (!project.cameraOnly) {
    autoZooms = hasPointerTracking(project)
      ? buildAutoZoomRegions(events, settings.zoom, duration)
      : buildMotionZoomRegions(project.activity, settings.zoom, duration);
  }
  const suppressed = new Set(project.suppressedZoomIds);
  const regions = combineZoomRegions(
    autoZooms.filter((r) => !suppressed.has(r.id)),
    project.cameraOnly ? [] : project.manualZooms
  );

  const typingCenter = (t: number): Point | null => {
    if (!settings.zoom.typingFocus) return null;
    const r = typingFocusAt(typing, t, settings.zoom.duration);
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
  };

  const camera = buildCameraPath(
    regions,
    (t) => (settings.zoom.followCursor ? cursorAt(t + FOLLOW_LOOKAHEAD_MS) ?? cursorAt(t) : null),
    typingCenter,
    { transitionMs: settings.zoom.transitionMs, deadzone: CAMERA_DEADZONE, smoothingMs: CAMERA_SMOOTHING_MS },
    duration
  );

  return { project, autoZooms, regions, camera, moves, clicks, keys, typing, scrolls, cursorAt };
}
