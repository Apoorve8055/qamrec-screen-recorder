import type {
  CaptureSurface,
  RecordingOptions,
  TimelineEvent,
  TrackerControl,
  TrackerMessage,
} from '../shared/types';
import { AudioMixer } from './audioMixer';
import { RecordingClock } from './clock';
import { EventLog, type TrackingStatus } from './eventLog';

export const TRACKER_PORT = 'qamrec-tracker';

export interface RecordingOutput {
  main: Blob;
  webcam: Blob | null;
  webcamOffsetMs: number | null;
  events: TimelineEvent[];
  surface: CaptureSurface;
  width: number;
  height: number;
  title: string;
}

type ChromeMediaConstraints = MediaTrackConstraints & {
  mandatory: { chromeMediaSource: string; chromeMediaSourceId: string; [key: string]: unknown };
};

function pickMimeType(candidates: string[]): string {
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

/** Records into memory; resolves with the recording when stopped */
class TrackRecorder {
  private chunks: Blob[] = [];
  private readonly recorder: MediaRecorder;
  readonly stopped: Promise<Blob>;
  startedAt = 0;

  constructor(stream: MediaStream, mimeType: string, videoBitsPerSecond: number) {
    this.recorder = new MediaRecorder(stream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond,
      audioBitsPerSecond: 160_000,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.stopped = new Promise((resolve) => {
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder.mimeType || 'video/webm' }));
    });
  }

  start() {
    this.startedAt = performance.now();
    this.recorder.start(1000);
  }
  pause() {
    if (this.recorder.state === 'recording') this.recorder.pause();
  }
  resume() {
    if (this.recorder.state === 'paused') this.recorder.resume();
  }
  stop() {
    if (this.recorder.state !== 'inactive') this.recorder.stop();
  }
}

/**
 * One recording: acquires capture streams, then records the main video (screen/tab/camera
 * with mixed audio) and, optionally, the webcam as a separate track so it can be restyled later.
 */
export class RecordingSession {
  readonly clock = new RecordingClock();
  readonly mixer = new AudioMixer();
  surface: CaptureSurface = 'monitor';
  width = 0;
  height = 0;
  previewStream: MediaStream | null = null;
  webcamStream: MediaStream | null = null;
  warnings: string[] = [];
  onSourceEnded: (() => void) | null = null;
  onTrackingChange: ((status: TrackingStatus) => void) | null = null;

  private streams: MediaStream[] = [];
  private eventLog: EventLog | null = null;
  private main: TrackRecorder | null = null;
  private webcam: TrackRecorder | null = null;
  private ports = new Set<chrome.runtime.Port>();
  private active = false;

  constructor(
    readonly options: RecordingOptions,
    private readonly tabStreamId: string | null
  ) {}

  /** Requests capture permissions and streams. Throws with a user-facing message on failure. */
  async acquire(): Promise<void> {
    const { source, systemAudio, microphone, noiseReduction, webcam } = this.options;
    let video: MediaStream;

    if (source === 'tab') {
      if (!this.tabStreamId) throw new Error('Tab capture is not available for this tab.');
      const tabConstraint = (extra: Record<string, unknown> = {}): ChromeMediaConstraints => ({
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: this.tabStreamId!, ...extra },
      });
      video = await navigator.mediaDevices.getUserMedia({
        video: tabConstraint({ maxWidth: 3840, maxHeight: 2160, maxFrameRate: 30 }),
        audio: systemAudio ? tabConstraint() : false,
      } as MediaStreamConstraints);
      this.surface = 'tab';
      this.mixer.addSource('system', video, { monitor: true });
    } else if (source === 'screen') {
      video = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: systemAudio,
        // Chrome-specific hints: offer tabs/windows/screens, hide this recorder window
        selfBrowserSurface: 'exclude',
        systemAudio: systemAudio ? 'include' : 'exclude',
        surfaceSwitching: 'include',
      } as DisplayMediaStreamOptions);
      const surface = video.getVideoTracks()[0].getSettings().displaySurface as CaptureSurface | undefined;
      this.surface = surface ?? 'monitor';
      this.mixer.addSource('system', video);
    } else {
      video = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: 'user' },
      });
      this.surface = 'camera';
    }
    this.streams.push(video);

    const videoTrack = video.getVideoTracks()[0];
    videoTrack.onended = () => this.onSourceEnded?.();
    const settings = videoTrack.getSettings();
    this.width = settings.width ?? 1920;
    this.height = settings.height ?? 1080;

    if (microphone) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { noiseSuppression: noiseReduction, echoCancellation: noiseReduction, autoGainControl: true },
        });
        this.streams.push(mic);
        this.mixer.addSource('mic', mic, { noiseReduction });
      } catch {
        this.warnings.push('Microphone unavailable — recording without it.');
      }
    }

    if (webcam && source !== 'camera') {
      try {
        this.webcamStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' },
        });
        this.streams.push(this.webcamStream);
      } catch {
        this.warnings.push('Webcam unavailable — recording without it.');
      }
    }

    await this.mixer.resume();
    this.previewStream = new MediaStream([videoTrack]);
    this.eventLog = new EventLog(this.clock, this.surface, this.width, this.height);
  }

  /** Accepts connections from the page tracker content script */
  attachTracker(port: chrome.runtime.Port): void {
    if (port.name !== TRACKER_PORT || !this.eventLog) return;
    this.ports.add(port);
    this.eventLog.setConnected(true);
    port.onMessage.addListener((msg: TrackerMessage) => {
      this.eventLog?.handle(msg);
      if (msg.type === 'viewport') this.onTrackingChange?.(this.eventLog!.status);
    });
    port.onDisconnect.addListener(() => {
      this.ports.delete(port);
      if (!this.ports.size) {
        this.eventLog?.setConnected(false);
        if (this.eventLog) this.onTrackingChange?.(this.eventLog.status);
      }
    });
    this.sendTrackerState(port);
  }

  get tracking(): TrackingStatus {
    return this.eventLog?.status ?? { connected: false, aligned: false, title: '' };
  }

  start(): void {
    const videoTrack = this.previewStream!.getVideoTracks()[0];
    const mainStream = new MediaStream([videoTrack]);
    const audioTrack = this.mixer.track;
    if (audioTrack) mainStream.addTrack(audioTrack);

    // Intermediate recording: generous bitrate, final quality is set on export
    const pixels = this.width * this.height;
    const bitrate = Math.min(16_000_000, Math.max(4_000_000, pixels * 4));
    this.main = new TrackRecorder(
      mainStream,
      pickMimeType(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']),
      bitrate
    );
    if (this.webcamStream) {
      this.webcam = new TrackRecorder(
        new MediaStream(this.webcamStream.getVideoTracks()),
        pickMimeType(['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']),
        3_000_000
      );
    }

    this.clock.start();
    this.main.start();
    this.webcam?.start();
    this.eventLog?.markStart();
    this.setActive(true);
  }

  pause(): void {
    this.main?.pause();
    this.webcam?.pause();
    this.clock.pause();
    this.setActive(false);
  }

  resume(): void {
    this.main?.resume();
    this.webcam?.resume();
    this.clock.resume();
    this.setActive(true);
  }

  addMarker(): void {
    this.eventLog?.addMarker();
  }

  async stop(): Promise<RecordingOutput> {
    this.setActive(false);
    this.clock.stop();
    this.main?.stop();
    this.webcam?.stop();
    const [main, webcam] = await Promise.all([this.main!.stopped, this.webcam?.stopped ?? Promise.resolve(null)]);
    const webcamOffsetMs = this.webcam ? Math.max(0, this.webcam.startedAt - this.main!.startedAt) : null;
    this.release();
    return {
      main,
      webcam,
      webcamOffsetMs,
      events: this.eventLog?.events ?? [],
      surface: this.surface,
      width: this.width,
      height: this.height,
      title: this.eventLog?.status.title ?? '',
    };
  }

  /** Stops all capture without keeping a recording */
  release(): void {
    for (const s of this.streams) s.getTracks().forEach((t) => t.stop());
    this.streams = [];
    this.mixer.close();
    for (const port of this.ports) port.disconnect();
    this.ports.clear();
  }

  private setActive(active: boolean) {
    this.active = active;
    for (const port of this.ports) this.sendTrackerState(port);
  }

  private sendTrackerState(port: chrome.runtime.Port) {
    const msg: TrackerControl = { type: 'state', active: this.active };
    try {
      port.postMessage(msg);
    } catch {
      this.ports.delete(port);
    }
  }
}
