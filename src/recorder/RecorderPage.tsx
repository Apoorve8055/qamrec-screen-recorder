import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Flag, GripHorizontal, Pause, Play, Square } from 'lucide-react';
import { LevelMeter } from '../components/ui';
import { FEATURES } from '../config/features';
import { formatDuration } from '../utils/format';
import { DEFAULT_RECORDING, deepMerge, effectsForRecording } from '../shared/settings';
import { loadState } from '../shared/storage';
import type {
  ControlCommand,
  DeepPartial,
  EffectsSettings,
  ExtensionMessage,
  RecordingOptions,
  RecordingState,
} from '../shared/types';
import { RecordingSession } from './session';
import type { TrackingStatus } from './eventLog';
import { finalizeRecording } from '../media/finalize';
import { analyzeRecording, type AnalysisResult } from '../analysis/analyze';
import { buildChapters } from '../analysis/scenes';
import { detectHighlights } from '../analysis/highlights';
import type { Project } from '../editor/project';
import { Editor } from '../editor/Editor';

type Phase = 'acquiring' | 'waiting' | 'countdown' | 'recording' | 'processing' | 'editing' | 'error';

export interface EditorData {
  project: Project;
  mainBlob: Blob;
  webcamBlob: Blob | null;
  analysis: AnalysisResult;
  recordedAt: Date;
  /** The saved look before per-recording (tutorial) overrides */
  baseEffects: EffectsSettings;
  recording: RecordingOptions;
}

const CHAPTER_MIN_GAP_MS = 8000;

function friendlyError(err: unknown): string {
  const e = err as Error;
  switch (e?.name) {
    case 'NotAllowedError':
      return 'Permission denied or sharing was cancelled.';
    case 'NotFoundError':
      return 'No camera or microphone found.';
    case 'NotReadableError':
      return 'The camera or microphone is in use by another app.';
    default:
      return e?.message || 'Something went wrong.';
  }
}

function sendStatus(state: RecordingState, elapsed: number) {
  const message: ExtensionMessage = { type: 'STATUS', status: { state, elapsed, updatedAt: Date.now() } };
  chrome.runtime.sendMessage(message).catch(() => {});
}

export function RecorderPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const options: RecordingOptions = useMemo(() => {
    let parsed: DeepPartial<RecordingOptions> = {};
    try {
      parsed = JSON.parse(params.get('o') ?? '{}');
    } catch {
      // Fall back to defaults
    }
    return deepMerge(DEFAULT_RECORDING, parsed);
  }, [params]);

  const sessionRef = useRef<RecordingSession | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);

  const [phase, setPhase] = useState<Phase>('acquiring');
  const phaseRef = useRef<Phase>('acquiring');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [levels, setLevels] = useState<{ system: number | null; mic: number | null }>({ system: null, mic: null });
  const [tracking, setTracking] = useState<TrackingStatus | null>(null);
  const [trackingNote, setTrackingNote] = useState<string | null>(null);
  const [processing, setProcessing] = useState({ label: '', progress: 0 });
  const [editorData, setEditorData] = useState<EditorData | null>(null);

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const startRecording = useCallback(() => {
    const session = sessionRef.current;
    if (!session || phaseRef.current === 'recording') return;
    session.start();
    go('recording');
    sendStatus('recording', 0);
    chrome.runtime.sendMessage({ type: 'RECORDING_STARTED', minimize: session.surface === 'monitor' }).catch(() => {});
  }, []);

  const beginCountdown = useCallback(() => {
    if (options.countdown <= 0) {
      startRecording();
      return;
    }
    go('countdown');
    setCountdown(options.countdown);
  }, [options.countdown, startRecording]);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    const current = phaseRef.current;
    if (!session) return;
    if (current === 'waiting' || current === 'countdown' || current === 'acquiring') {
      session.release();
      sendStatus('idle', 0);
      window.close();
      return;
    }
    if (current !== 'recording') return;

    go('processing');
    sendStatus('editing', session.clock.elapsed());
    chrome.runtime.sendMessage({ type: 'RECORDING_STOPPED' }).catch(() => {});

    try {
      setProcessing({ label: 'Finalizing recording…', progress: 0.02 });
      const out = await session.stop();
      const main = await finalizeRecording(out.main);
      const webcam = out.webcam ? await finalizeRecording(out.webcam) : null;

      setProcessing({ label: 'Analyzing scenes, audio and activity…', progress: 0.1 });
      const analysis = await analyzeRecording(main.blob, main.durationMs, (p) =>
        setProcessing({ label: 'Analyzing scenes, audio and activity…', progress: 0.1 + 0.9 * p })
      );

      const stored = await loadState();
      const duration = main.durationMs;
      const events = out.events.filter((e) => e.t <= duration);
      const project: Project = {
        duration,
        mode: options.source,
        surface: out.surface,
        sourceWidth: main.width || out.width,
        sourceHeight: main.height || out.height,
        webcamOffsetMs: webcam ? out.webcamOffsetMs ?? 0 : null,
        cameraOnly: options.source === 'camera',
        title: out.title,
        events,
        activity: analysis.activity,
        cuts: [],
        manualZooms: [],
        suppressedZoomIds: [],
        chapters: buildChapters(analysis.sceneCuts, events, duration, CHAPTER_MIN_GAP_MS),
        highlights: detectHighlights(events, analysis.activity, duration, { windowMs: 6000, count: 3 }),
        subtitles: [],
        settings: effectsForRecording(stored.effects, options),
      };
      setEditorData({
        project,
        mainBlob: main.blob,
        webcamBlob: webcam?.blob ?? null,
        analysis,
        recordedAt: new Date(),
        baseEffects: stored.effects,
        recording: options,
      });
      go('editing');
    } catch (err) {
      setError(`Could not process the recording: ${friendlyError(err)}`);
      go('error');
    }
  }, [options]);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const control = useCallback((command: ControlCommand) => {
    const session = sessionRef.current;
    if (!session) return;
    const isPaused = session.clock.isPaused();
    if (command === 'stop') {
      stopRef.current();
    } else if (command === 'marker') {
      session.addMarker();
    } else if (phaseRef.current === 'recording') {
      const wantPause = command === 'pause' || (command === 'toggle-pause' && !isPaused);
      const wantResume = command === 'resume' || (command === 'toggle-pause' && isPaused);
      if (wantPause && !isPaused) {
        session.pause();
        setPaused(true);
        sendStatus('paused', session.clock.elapsed());
      } else if (wantResume && isPaused) {
        session.resume();
        setPaused(false);
        sendStatus('recording', session.clock.elapsed());
      }
    }
  }, []);

  // Acquire capture on open
  useEffect(() => {
    const session = new RecordingSession(options, params.get('sid') || null);
    sessionRef.current = session;
    const onConnect = (port: chrome.runtime.Port) => session.attachTracker(port);
    chrome.runtime.onConnect.addListener(onConnect);
    session.onSourceEnded = () => stopRef.current();
    session.onTrackingChange = setTracking;

    (async () => {
      try {
        await session.acquire();
      } catch (err) {
        setError(friendlyError(err));
        go('error');
        sendStatus('idle', 0);
        return;
      }
      setWarnings(session.warnings);
      if (options.source !== 'camera' && FEATURES.PAGE_TRACKING) {
        chrome.runtime
          .sendMessage({ type: 'INJECT_TRACKER' })
          .then((res?: { ok: boolean }) => {
            if (!res?.ok) setTrackingNote('Page effects unavailable on this page — using smart auto-framing.');
          })
          .catch(() => {});
      }
      const startAt = options.schedule.startAt;
      if (startAt && startAt > Date.now()) {
        setWaitUntil(startAt);
        go('waiting');
      } else {
        beginCountdown();
      }
    })();

    return () => {
      chrome.runtime.onConnect.removeListener(onConnect);
    };
    // Runs once per recorder window
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Commands from the popup and keyboard shortcuts
  useEffect(() => {
    const onMessage = (msg: ExtensionMessage) => {
      if (msg.type === 'CONTROL') control(msg.command);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [control]);

  // Live preview
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (liveVideoRef.current && session.previewStream && liveVideoRef.current.srcObject !== session.previewStream) {
      liveVideoRef.current.srcObject = session.previewStream;
      liveVideoRef.current.play().catch(() => {});
    }
    if (webcamVideoRef.current && session.webcamStream && webcamVideoRef.current.srcObject !== session.webcamStream) {
      webcamVideoRef.current.srcObject = session.webcamStream;
      webcamVideoRef.current.play().catch(() => {});
    }
  }, [phase]);

  // Scheduled start
  useEffect(() => {
    if (phase !== 'waiting' || !waitUntil) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= waitUntil) beginCountdown();
    }, 250);
    return () => window.clearInterval(id);
  }, [phase, waitUntil, beginCountdown]);

  // Countdown
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      startRecording();
      return;
    }
    const id = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [phase, countdown, startRecording]);

  // Timer, level meters, auto-stop
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'waiting' && phase !== 'countdown') return;
    const limitMs = options.schedule.stopAfterMin ? options.schedule.stopAfterMin * 60_000 : null;
    const id = window.setInterval(() => {
      const session = sessionRef.current;
      if (!session) return;
      const e = session.clock.elapsed();
      setElapsed(e);
      setLevels({ system: session.mixer.level('system'), mic: session.mixer.level('mic') });
      if (phaseRef.current === 'recording' && limitMs !== null && e >= limitMs) stopRef.current();
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, options.schedule.stopAfterMin]);

  // Protect unsaved work
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (['recording', 'processing', 'editing'].includes(phaseRef.current)) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  if (phase === 'editing' && editorData) {
    return <Editor data={editorData} />;
  }

  const limitMs = options.schedule.stopAfterMin ? options.schedule.stopAfterMin * 60_000 : null;
  const modeLabel = { screen: 'Screen', tab: 'This tab', camera: 'Camera' }[options.source];
  const live = phase === 'recording' && !paused;
  const trackingLabel =
    tracking?.connected && tracking.aligned
      ? `Tracking clicks and keys${tracking.title ? `: ${tracking.title}` : ''}`
      : options.source !== 'camera'
        ? trackingNote ?? 'Smart auto-framing from on-screen motion'
        : null;

  return (
    <div className="flex h-screen flex-col bg-deep text-paper">
      {/* Title strip */}
      <div className="flex h-7 flex-shrink-0 items-center justify-between border-b border-line bg-card px-3">
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-fog/50">
          <GripHorizontal className="h-3 w-3" /> Qamrec HUD
        </span>
        <span className="font-mono text-[10px] text-fog/50">{modeLabel}</span>
      </div>

      {error && (
        <div className="flex flex-1 items-center justify-center p-6">
          <div role="alert" className="w-full max-w-sm rounded-2xl border border-rec/40 bg-card p-5">
            <div className="label-mono mb-2 text-rec">Recording couldn’t start</div>
            <p className="text-[13px] text-paper">{error}</p>
            <div className="mt-4 flex gap-2">
              <button className="btn-accent h-8 px-4 text-[11px]" onClick={() => window.location.reload()}>
                Try again
              </button>
              <button className="btn-pill" onClick={() => window.close()}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'acquiring' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-violet border-r-ember" />
          <p className="font-mono text-[11px] text-fog">
            {options.source === 'screen' ? 'Choose what to share…' : 'Requesting permissions…'}
          </p>
        </div>
      )}

      {phase === 'processing' && (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-80">
            <div className="mb-3 flex items-center justify-between font-mono text-[10px] text-fog">
              <span>{processing.label}</span>
              <span>{Math.round(processing.progress * 100)}%</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${Math.round(processing.progress * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {(phase === 'waiting' || phase === 'countdown' || phase === 'recording') && (
        <>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-deep">
            <video ref={liveVideoRef} className="h-full w-full object-contain" muted playsInline />

            {/* Viewfinder: vignette, inner frame and corner marks */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: 'radial-gradient(120% 120% at 50% 50%, transparent 60%, rgba(0,0,0,0.6) 100%)' }}
            />
            <div className="pointer-events-none absolute inset-2 border border-white/[0.06]" />
            {['left-2 top-2 border-l border-t', 'right-2 top-2 border-r border-t', 'bottom-2 left-2 border-b border-l', 'bottom-2 right-2 border-b border-r'].map(
              (pos) => (
                <div key={pos} className={`pointer-events-none absolute h-4 w-4 border-white/25 ${pos}`} />
              )
            )}

            {/* Top bar: REC + timecode */}
            <div className="absolute inset-x-0 top-0 flex h-9 items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    live ? 'animate-blink bg-rec shadow-[0_0_6px_#FF3B30]' : paused ? 'bg-mark' : 'bg-white/30'
                  }`}
                />
                <span className="font-mono text-[11px] font-bold tracking-[0.12em] text-white">
                  {phase === 'recording' ? (paused ? 'PAUSED' : 'REC') : phase === 'countdown' ? 'READY' : 'STBY'}
                </span>
                <span className="font-mono text-[11px] tracking-widest text-white/70">{timecode(elapsed)}</span>
                {limitMs !== null && phase === 'recording' && (
                  <span className="font-mono text-[10px] text-white/40">stops in {formatDuration(Math.max(0, limitMs - elapsed))}</span>
                )}
              </div>
              {tracking?.title && <span className="max-w-[40%] truncate font-mono text-[10px] text-white/40">{tracking.title}</span>}
            </div>

            {/* Audio meters */}
            {(levels.system !== null || levels.mic !== null) && (
              <div className="absolute bottom-4 left-4 flex flex-col gap-3 rounded-xl bg-black/40 px-3 py-2.5 backdrop-blur">
                <LevelMeter label={options.source === 'tab' ? 'Tab' : 'Sys'} level={levels.system} />
                <LevelMeter label="Mic" level={levels.mic} tone="white" />
              </div>
            )}

            {/* Webcam: proves the camera is working */}
            {options.webcam && (
              <div className="absolute right-4 top-12 h-28 w-28 overflow-hidden rounded-full border border-white/15 bg-lift shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                <video ref={webcamVideoRef} className="h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }} muted playsInline />
                <div className="absolute inset-x-0 bottom-0 h-[2px] bg-accent" />
              </div>
            )}

            {/* Film leader countdown */}
            {phase === 'countdown' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-deep">
                <div
                  className="absolute inset-0 opacity-[0.06]"
                  style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, white 2px, white 3px)' }}
                />
                <div className="relative flex h-40 w-40 items-center justify-center rounded-full border-[6px] border-raised bg-[#111118]">
                  <div className="absolute inset-2 rounded-full border border-dashed border-line opacity-40" />
                  <span key={countdown} className="font-mono text-[76px] font-black tracking-tighter text-white">
                    {countdown}
                  </span>
                  <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-paper" />
                </div>
                <div className="mt-6 flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] text-white/30">
                  <Film className="h-3 w-3" /> PICTURE START
                </div>
                <div className="mt-3 h-[2px] w-[72px] bg-accent" />
                <button className="mt-8 font-mono text-[11px] text-white/40 hover:text-white/70" onClick={() => stopRef.current()}>
                  CANCEL
                </button>
              </div>
            )}

            {/* Scheduled start */}
            {phase === 'waiting' && waitUntil && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-deep/90">
                <div className="label-mono">
                  Starts at {new Date(waitUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <p className="my-3 font-mono text-[56px] font-semibold tracking-tight">{timecode(Math.max(0, waitUntil - now))}</p>
                <div className="flex gap-2">
                  <button className="btn-accent h-9 px-5 text-[12px]" onClick={beginCountdown}>
                    Start now
                  </button>
                  <button className="btn-pill h-9" onClick={() => stopRef.current()}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Control bar */}
          <div className="flex h-12 flex-shrink-0 items-center gap-2 border-t border-line/60 bg-ink/95 px-3">
            {phase === 'recording' && (
              <>
                <button
                  className="btn-pill h-7"
                  onClick={() => control(paused ? 'resume' : 'pause')}
                  title={paused ? 'Resume (Alt+Shift+P)' : 'Pause (Alt+Shift+P)'}
                >
                  {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                  {paused ? 'RESUME' : 'PAUSE'}
                </button>
                <button
                  className="btn-pill h-7 w-7 justify-center px-0"
                  onClick={() => control('marker')}
                  title="Mark a highlight (Alt+Shift+M)"
                  aria-label="Mark a highlight"
                >
                  <Flag className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
              {trackingLabel && (
                <span
                  className={`truncate rounded-full border px-2.5 py-0.5 font-mono text-[10px] ${
                    tracking?.connected && tracking.aligned ? 'border-violet/30 text-paper/80' : 'border-line text-fog/60'
                  }`}
                >
                  {trackingLabel}
                </span>
              )}
              {warnings.map((w) => (
                <span key={w} className="truncate font-mono text-[10px] text-mark/80">
                  {w}
                </span>
              ))}
            </div>
            {phase === 'recording' ? (
              <button className="btn-rec" onClick={() => stopRef.current()} title="Stop (Alt+Shift+S)">
                <Square className="h-3 w-3 fill-white" />
                STOP
              </button>
            ) : (
              <button className="btn-pill" onClick={() => stopRef.current()}>
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** HH:MM:SS */
function timecode(ms: number): string {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
