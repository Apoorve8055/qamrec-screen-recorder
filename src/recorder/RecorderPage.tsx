import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PauseIcon, PlayIcon, StopIcon, MarkerIcon } from '../components/Icons';
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
  const modeLabel = { screen: 'Screen', tab: 'Tab', camera: 'Camera' }[options.source];

  return (
    <div className="flex h-screen flex-col bg-gray-900 text-white">
      {error && (
        <div className="m-3 rounded-lg bg-red-600 px-4 py-3 text-sm">
          <p>{error}</p>
          <div className="mt-2 flex gap-3">
            <button className="underline" onClick={() => window.location.reload()}>
              Try again
            </button>
            <button className="underline" onClick={() => window.close()}>
              Close
            </button>
          </div>
        </div>
      )}

      {phase === 'acquiring' && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-12 w-12 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
            <p className="text-sm text-gray-400">
              {options.source === 'screen' ? 'Choose what to share…' : 'Requesting permissions…'}
            </p>
          </div>
        </div>
      )}

      {phase === 'processing' && (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-72 text-center">
            <p className="mb-3 text-sm text-gray-300">{processing.label}</p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700">
              <div
                className="h-full bg-primary-500 transition-[width]"
                style={{ width: `${Math.round(processing.progress * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {(phase === 'waiting' || phase === 'countdown' || phase === 'recording') && (
        <>
          <div className="relative min-h-0 flex-1 bg-black">
            <video ref={liveVideoRef} className="h-full w-full object-contain" muted playsInline />
            {options.webcam && (
              <video
                ref={webcamVideoRef}
                className="absolute bottom-3 right-3 h-28 w-28 rounded-full border-2 border-white/70 object-cover shadow-xl"
                style={{ transform: 'scaleX(-1)' }}
                muted
                playsInline
              />
            )}

            <div className="absolute left-2 top-2 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5">
              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  phase !== 'recording' ? 'bg-gray-400' : paused ? 'bg-yellow-500' : 'bg-red-500 recording-pulse'
                }`}
              />
              <span className="font-mono text-sm">{formatDuration(elapsed)}</span>
              {paused && <span className="text-xs text-yellow-400">PAUSED</span>}
              {limitMs !== null && phase === 'recording' && (
                <span className="text-xs text-gray-400">· stops in {formatDuration(Math.max(0, limitMs - elapsed))}</span>
              )}
            </div>
            <div className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-xs">{modeLabel}</div>

            {phase === 'countdown' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <span key={countdown} className="text-8xl font-bold text-white drop-shadow-lg">
                  {countdown}
                </span>
              </div>
            )}

            {phase === 'waiting' && waitUntil && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                <div className="text-center">
                  <p className="text-sm text-gray-300">
                    Recording starts at{' '}
                    {new Date(waitUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <p className="my-2 font-mono text-5xl">{formatDuration(Math.max(0, waitUntil - now))}</p>
                  <div className="flex justify-center gap-3">
                    <button className="btn-primary text-sm" onClick={beginCountdown}>
                      Start now
                    </button>
                    <button className="btn-secondary text-sm" onClick={() => stopRef.current()}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2 bg-gray-800 px-4 py-3">
            <div className="flex items-center gap-3 text-xs">
              {tracking?.connected && tracking.aligned ? (
                <span className="rounded-full bg-green-600/20 px-2 py-0.5 text-green-300">
                  Tracking clicks &amp; keys{tracking.title ? ` · ${tracking.title}` : ''}
                </span>
              ) : options.source !== 'camera' ? (
                <span className="rounded-full bg-gray-700 px-2 py-0.5 text-gray-300">
                  {trackingNote ?? 'Effects: smart auto-framing from on-screen motion'}
                </span>
              ) : null}
              {warnings.map((w) => (
                <span key={w} className="text-yellow-400">
                  {w}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-4">
              <div className="w-56 space-y-1">
                <LevelMeter label={options.source === 'tab' ? 'Tab' : 'System'} level={levels.system} />
                <LevelMeter label="Mic" level={levels.mic} />
              </div>
              <div className="ml-auto flex items-center gap-3">
                {phase === 'recording' && (
                  <>
                    <button
                      onClick={() => control('marker')}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600"
                      title="Mark a highlight (Alt+Shift+M)"
                    >
                      <MarkerIcon />
                    </button>
                    <button
                      onClick={() => control(paused ? 'resume' : 'pause')}
                      className={`flex h-12 w-12 items-center justify-center rounded-full ${
                        paused ? 'bg-green-600 hover:bg-green-500' : 'bg-yellow-600 hover:bg-yellow-500'
                      }`}
                      title={paused ? 'Resume (Alt+Shift+P)' : 'Pause (Alt+Shift+P)'}
                    >
                      {paused ? <PlayIcon /> : <PauseIcon />}
                    </button>
                  </>
                )}
                <button
                  onClick={() => stopRef.current()}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-500"
                  title={phase === 'recording' ? 'Stop (Alt+Shift+S)' : 'Cancel'}
                >
                  <StopIcon />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
