import type { CaptureSurface, TimelineEvent, TrackerMessage, ViewportInfo } from '../shared/types';
import { mapViewportPoint, mapViewportRect, mappingIsPlausible } from '../effects/coords';
import type { RecordingClock } from './clock';

export interface TrackingStatus {
  /** A page tracker is connected */
  connected: boolean;
  /** The tracked page matches what's being captured, so pointer effects apply */
  aligned: boolean;
  title: string;
}

/** Off-surface marker understood by the scene builder (pointer effects pause) */
const OFF_SURFACE = -1;

type EventWithoutTime = TimelineEvent extends infer E ? (E extends TimelineEvent ? Omit<E, 't'> : never) : never;

/**
 * Converts page tracker messages into timeline events: wall-clock instants become
 * recording time and page coordinates become normalized video coordinates.
 */
export class EventLog {
  readonly events: TimelineEvent[] = [];
  private vp: ViewportInfo | null = null;
  private aligned = false;
  private connected = false;
  private lastTitle = '';

  constructor(
    private readonly clock: RecordingClock,
    private readonly surface: CaptureSurface,
    private readonly captureWidth: number,
    private readonly captureHeight: number
  ) {}

  get status(): TrackingStatus {
    return { connected: this.connected, aligned: this.aligned, title: this.vp?.title ?? '' };
  }

  /** Call right after the clock starts: records the page the recording begins on */
  markStart(): void {
    if (this.vp?.title) this.push({ t: 0, type: 'page', title: this.vp.title });
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
    if (!connected) this.pushNow({ type: 'move', x: OFF_SURFACE, y: OFF_SURFACE });
  }

  addMarker(): void {
    this.pushNow({ type: 'marker' });
  }

  handle(msg: TrackerMessage): void {
    if (msg.type === 'viewport') {
      this.vp = msg.vp;
      this.aligned = mappingIsPlausible(msg.vp, this.surface, this.captureWidth, this.captureHeight);
      if (msg.vp.title && msg.vp.title !== this.lastTitle) {
        this.lastTitle = msg.vp.title;
        this.pushNow({ type: 'page', title: msg.vp.title });
      }
      return;
    }

    if (!this.vp || !this.aligned) return;
    const t = this.clock.activeTimeAt(msg.at);
    if (t === null) return;

    switch (msg.type) {
      case 'move':
      case 'click': {
        const p = mapViewportPoint({ x: msg.x, y: msg.y }, this.vp, this.surface);
        this.push({ t, type: msg.type, x: p.x, y: p.y });
        break;
      }
      case 'key':
        this.push({ t, type: 'key', label: msg.label });
        break;
      case 'typing':
        this.push({ t, type: 'typing', rect: msg.rect ? mapViewportRect(msg.rect, this.vp, this.surface) : null });
        break;
      case 'focus':
        this.push({ t, type: 'focus', rect: mapViewportRect(msg.rect, this.vp, this.surface) });
        break;
      case 'scroll':
        this.push({ t, type: 'scroll', dy: msg.dy });
        break;
      case 'visibility':
        if (!msg.visible) this.push({ t, type: 'move', x: OFF_SURFACE, y: OFF_SURFACE });
        break;
    }
  }

  private pushNow(e: EventWithoutTime): void {
    const t = this.clock.activeTimeAt(Date.now());
    if (t !== null) this.push({ ...e, t } as TimelineEvent);
  }

  private push(e: TimelineEvent): void {
    // Keep sorted; out-of-order arrival is rare and small
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].t > e.t) i--;
    this.events.splice(i, 0, e);
  }
}
