import { useEffect, useState, type ComponentType } from 'react';
import {
  AppWindow,
  Bookmark,
  Camera,
  Clapperboard,
  Clock,
  Flag,
  GraduationCap,
  ImagePlay,
  Lock,
  Mic,
  MousePointerClick,
  Pause,
  Play,
  Plus,
  Scan,
  ShieldCheck,
  Sparkles,
  Square,
  Timer,
  UserRound,
  Volume2,
  Webcam,
  WandSparkles,
  X,
  type LucideProps,
} from 'lucide-react';
import { isFeatureEnabled } from '../config/features';
import { Lever } from '../components/ui';
import { formatDuration } from '../utils/format';
import { BUILTIN_PRESETS, DEFAULT_EFFECTS, DEFAULT_RECORDING, applyPreset } from '../shared/settings';
import { loadState, saveState, type StoredState } from '../shared/storage';
import type { CaptureSource, ControlCommand, Preset, RecordingOptions, RecordingStatus } from '../shared/types';

type ScheduleMode = 'now' | 'in' | 'at';
type Icon = ComponentType<LucideProps>;

/** Next epoch ms at which the wall clock reads HH:MM */
function nextTimeOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** How each built-in preset reads on its card */
const PRESET_META: Record<string, { icon: Icon; sub: string }> = {
  default: { icon: Sparkles, sub: 'Auto zoom + cursor' },
  cinematic: { icon: Clapperboard, sub: 'Deep zooms + chapters' },
  tutorial: { icon: GraduationCap, sub: 'Voice + clicks + keys' },
  minimal: { icon: Scan, sub: 'No effects' },
  gif: { icon: ImagePlay, sub: 'Small looping GIF' },
  'talking-head': { icon: UserRound, sub: 'Cam + mic, blurred' },
};

const COUNTDOWNS = [0, 3, 5, 10];

export function Popup() {
  const [stored, setStored] = useState<StoredState | null>(null);
  const [status, setStatus] = useState<RecordingStatus>({ state: 'idle', elapsed: 0, updatedAt: Date.now() });
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('now');
  const [startInMin, setStartInMin] = useState(5);
  const [startAtTime, setStartAtTime] = useState('09:00');
  const [namingPreset, setNamingPreset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    loadState().then(setStored);
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response?: RecordingStatus) => {
      if (response) setStatus(response);
    });
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => setTab(t ?? null));
  }, []);

  const inSession = status.state === 'recording' || status.state === 'paused' || status.state === 'armed';

  useEffect(() => {
    if (!inSession) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [inSession]);

  // Matches the loaded panel's natural height so the popup does not resize as settings arrive
  if (!stored) return <div className="h-[540px] w-[672px] bg-card" />;

  const recording = stored.recording;
  const presets: Preset[] = [...BUILTIN_PRESETS, ...stored.userPresets];
  const tabScriptable = !!tab?.url && /^(https?|file):/.test(tab.url);

  const update = (patch: Partial<RecordingOptions>) => {
    const next = { ...stored, recording: { ...recording, ...patch } };
    setStored(next);
    saveState({ recording: next.recording });
  };

  const choosePreset = (id: string) => {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    // Presets are absolute: applied on top of defaults, not on top of the current tweaks
    const applied = applyPreset(DEFAULT_RECORDING, DEFAULT_EFFECTS, preset);
    const next = { ...stored, ...applied, activePresetId: id };
    setStored(next);
    saveState(next);
  };

  const savePreset = (name: string) => {
    const preset: Preset = {
      id: `user-${Date.now()}`,
      name: name.trim() || 'My preset',
      builtin: false,
      recording: { ...recording, schedule: { startAt: null, stopAfterMin: recording.schedule.stopAfterMin } },
      effects: stored.effects,
    };
    const next = { ...stored, userPresets: [...stored.userPresets, preset], activePresetId: preset.id };
    setStored(next);
    saveState(next);
    setNamingPreset(null);
  };

  const deletePreset = (id: string) => {
    const next = {
      ...stored,
      userPresets: stored.userPresets.filter((p) => p.id !== id),
      activePresetId: stored.activePresetId === id ? 'default' : stored.activePresetId,
    };
    setStored(next);
    saveState(next);
  };

  const start = async () => {
    setError(null);
    setStarting(true);
    const startAt =
      scheduleMode === 'in' ? Date.now() + startInMin * 60_000 : scheduleMode === 'at' ? nextTimeOfDay(startAtTime) : null;
    const options: RecordingOptions = { ...recording, schedule: { ...recording.schedule, startAt } };
    const response = await chrome.runtime.sendMessage({ type: 'OPEN_RECORDER', options, tabId: tab?.id ?? null });
    if (response?.success === false) {
      setError(response.error ?? 'Could not start recording');
      setStarting(false);
      return;
    }
    window.close();
  };

  const control = (command: ControlCommand) => {
    chrome.runtime.sendMessage({ type: 'CONTROL', command }).catch(() => {});
  };

  const elapsed = status.elapsed + (status.state === 'recording' ? now - status.updatedAt : 0);
  const live = status.state === 'recording';

  const sources: { id: CaptureSource; label: string; hint: string; icon: Icon; enabled: boolean }[] = [
    {
      id: 'tab',
      label: 'This Tab',
      hint: tabScriptable ? 'Auto-zoom, clicks and keystrokes' : 'Page effects are unavailable on this page',
      icon: AppWindow,
      enabled: isFeatureEnabled('TAB_RECORDING'),
    },
    {
      id: 'screen',
      label: 'Screen',
      hint: 'Pick a screen, window or any tab',
      icon: Scan,
      enabled: isFeatureEnabled('SCREEN_RECORDING'),
    },
    {
      id: 'camera',
      label: 'Camera',
      hint: 'Webcam only',
      icon: Camera,
      enabled: isFeatureEnabled('CAMERA_RECORDING'),
    },
  ];

  const includes: {
    key: string;
    label: string;
    status: string;
    icon: Icon;
    checked: boolean;
    disabled: boolean;
    set: (v: boolean) => void;
    show: boolean;
  }[] = [
    {
      key: 'webcam',
      label: 'Webcam overlay',
      status: recording.source === 'camera' ? 'Camera is the recording' : 'Separate track, restyle later',
      icon: Webcam,
      checked: recording.webcam,
      disabled: recording.source === 'camera',
      set: (v) => update({ webcam: v }),
      show: isFeatureEnabled('SCREEN_CAMERA'),
    },
    {
      key: 'audio',
      label: recording.source === 'tab' ? 'Tab audio' : 'System audio',
      status: recording.source === 'camera' ? 'Not available for camera' : 'Mixed with your mic',
      icon: Volume2,
      checked: recording.systemAudio,
      disabled: recording.source === 'camera',
      set: (v) => update({ systemAudio: v }),
      show: isFeatureEnabled('SYSTEM_AUDIO'),
    },
    {
      key: 'mic',
      label: 'Microphone',
      status: 'Your voice',
      icon: Mic,
      checked: recording.microphone,
      disabled: false,
      set: (v) => update({ microphone: v }),
      show: true,
    },
    {
      key: 'denoise',
      label: 'Noise reduction',
      status: recording.microphone ? 'Cleans up mic hiss and hum' : 'Needs the microphone',
      icon: WandSparkles,
      checked: recording.noiseReduction,
      disabled: !recording.microphone,
      set: (v) => update({ noiseReduction: v }),
      show: true,
    },
    {
      key: 'tutorial',
      label: 'Tutorial mode',
      status: 'Numbered clicks, keys, cursor',
      icon: MousePointerClick,
      checked: recording.tutorialMode,
      disabled: false,
      set: (v) => update({ tutorialMode: v }),
      show: true,
    },
  ];

  return (
    // Chrome caps popups at 600x800. Every panel fits inside that, so this is a ceiling,
    // not a fixed height: the popup sizes to its content and never scrolls.
    <div className="relative flex max-h-[600px] w-[672px] flex-col overflow-hidden bg-card text-paper">
      {/* Soft violet light from above */}
      <div className="pointer-events-none absolute -top-20 left-1/2 h-[160px] w-[220px] -translate-x-1/2 bg-gradient-to-b from-violet/15 to-transparent blur-[24px]" />

      {/* Header */}
      <header className="relative flex flex-shrink-0 items-center gap-2.5 border-b border-line/70 px-3.5 pb-2.5 pt-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-br shadow-orb">
          <div className="h-2 w-2 rounded-full bg-white shadow-[0_0_8px_white]" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-bold tracking-[0.04em]">QAMREC</span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                live ? 'animate-blink bg-rec' : status.state === 'paused' ? 'bg-mark' : 'bg-white/20'
              }`}
            />
            <span className="font-mono text-[10px] tracking-widest text-fog">
              {live ? 'REC' : status.state === 'paused' ? 'PAUSED' : status.state === 'armed' ? 'ARMED' : 'STBY'}
            </span>
          </div>
          <div className="-mt-0.5 flex items-center gap-1 text-[10px] text-fog/70">
            <Lock className="h-3 w-3" /> Cinematic recorder, local only
          </div>
        </div>
      </header>

      {error && (
        <div role="alert" className="relative mx-3.5 mt-2 flex-shrink-0 rounded-xl border border-rec/40 bg-rec/10 px-3 py-2 text-[11px] text-paper">
          {error}
        </div>
      )}

      {inSession ? (
        <div className="relative flex flex-1 flex-col items-center justify-center px-3.5 pb-3 pt-4 text-center">
          <div className="label-mono">
            {status.state === 'armed' ? 'Getting ready' : status.state === 'paused' ? 'Paused' : 'Recording'}
          </div>
          <p className="mb-4 mt-1 font-mono text-[36px] font-semibold tracking-tight">{formatDuration(elapsed)}</p>
          {status.state !== 'armed' && (
            <div className="flex items-center justify-center gap-2">
              <button className="btn-pill" onClick={() => control(status.state === 'paused' ? 'resume' : 'pause')}>
                {status.state === 'paused' ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                {status.state === 'paused' ? 'RESUME' : 'PAUSE'}
              </button>
              <button className="btn-pill w-8 justify-center px-0" onClick={() => control('marker')} title="Mark a highlight">
                <Flag className="h-3.5 w-3.5" />
              </button>
              <button className="btn-rec" onClick={() => control('stop')}>
                <Square className="h-3 w-3 fill-white" /> STOP
              </button>
            </div>
          )}
          <p className="mt-4 font-mono text-[10px] leading-relaxed text-fog/50">
            Alt+Shift+S stop · Alt+Shift+P pause · Alt+Shift+M marker
          </p>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {/* Presets */}
          {isFeatureEnabled('PRESETS') && (
            <div className="px-3.5 pt-1.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label-mono">Presets</span>
                {namingPreset === null && (
                  <button
                    className="flex items-center gap-1 font-mono text-[10px] text-fog/50 hover:text-paper"
                    onClick={() => setNamingPreset('')}
                  >
                    <Plus className="h-3 w-3" /> Save current
                  </button>
                )}
              </div>
              {namingPreset !== null && (
                <form
                  className="mb-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    savePreset(namingPreset);
                  }}
                >
                  <input
                    autoFocus
                    value={namingPreset}
                    onChange={(e) => setNamingPreset(e.target.value)}
                    placeholder="Preset name"
                    className="field flex-1 rounded-full px-3"
                  />
                  <button type="submit" className="btn-pill h-7">
                    Save
                  </button>
                  <button type="button" className="btn-pill h-7" onClick={() => setNamingPreset(null)}>
                    Cancel
                  </button>
                </form>
              )}
              <div className="-mx-3.5 flex snap-x scroll-px-3.5 gap-2 overflow-x-auto px-3.5 pb-1">
                {presets.map((p) => {
                  const active = stored.activePresetId === p.id;
                  const meta = PRESET_META[p.id] ?? { icon: Bookmark, sub: 'Your preset' };
                  const PresetIcon = meta.icon;
                  return (
                    <div key={p.id} className="group relative w-[96px] flex-shrink-0 snap-start">
                      <button
                        onClick={() => choosePreset(p.id)}
                        aria-pressed={active}
                        className={`relative h-full w-full overflow-hidden rounded-xl border px-2 py-1.5 text-left transition-all duration-300 ${
                          active
                            ? 'border-violet/40 bg-raised shadow-[0_0_20px_rgba(168,85,247,0.15),inset_0_1px_0_rgba(255,255,255,0.06)]'
                            : 'border-line/60 bg-ink/60 hover:border-line hover:bg-lift'
                        }`}
                      >
                        {active && (
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet/10 to-ember/10" />
                        )}
                        <div
                          className={`relative mb-1.5 flex h-6 w-6 items-center justify-center rounded-full transition-all ${
                            active ? 'bg-accent-br text-white shadow-orb' : 'bg-line text-fog group-hover:text-white/70'
                          }`}
                        >
                          <PresetIcon className="h-3 w-3" />
                        </div>
                        <div className={`relative truncate text-[11px] font-semibold leading-none ${active ? 'text-paper' : 'text-fog'}`}>
                          {p.name}
                        </div>
                        <div className="relative mt-1 text-[9px] leading-tight text-fog/60">{meta.sub}</div>
                      </button>
                      {!p.builtin && (
                        <button
                          className="absolute right-1.5 top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-ink/80 text-fog hover:text-paper group-hover:flex"
                          onClick={() => deletePreset(p.id)}
                          title={`Delete “${p.name}”`}
                          aria-label={`Delete preset ${p.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Source */}
          <div className="px-3.5 pt-1.5">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="label-mono">Source</span>
              <span className="truncate font-mono text-[10px] text-fog/50">
                {sources.find((s) => s.id === recording.source)?.hint}
              </span>
            </div>
            <div className="relative flex h-9 rounded-full border border-line bg-ink p-1 shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)]">
              {sources
                .filter((s) => s.enabled)
                .map((s) => {
                  const active = recording.source === s.id;
                  const SourceIcon = s.icon;
                  return (
                    <button
                      key={s.id}
                      onClick={() => update({ source: s.id })}
                      aria-pressed={active}
                      title={s.hint}
                      className={`relative flex h-full flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-full text-[11px] font-medium tracking-wide transition-colors duration-300 ${
                        active ? 'text-white' : 'text-fog/60 hover:text-fog'
                      }`}
                    >
                      {active && (
                        <>
                          <span className="absolute inset-0 rounded-full bg-accent" />
                          <span className="absolute inset-[1px] rounded-full bg-raised" />
                          <span className="absolute inset-[1px] rounded-full bg-gradient-to-r from-violet/20 to-ember/20" />
                        </>
                      )}
                      <SourceIcon className="relative h-3.5 w-3.5" />
                      <span className="relative">{s.label}</span>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Include */}
          <div className="px-3.5 pt-1.5">
            <div className="label-mono mb-2">Include</div>
            {/* Three across, so the five widgets need two rows and the panel never scrolls */}
            <div className="grid grid-cols-3 gap-1.5">
              {includes
                .filter((row) => row.show)
                .map((row) => {
                  const RowIcon = row.icon;
                  const on = row.checked && !row.disabled;
                  return (
                    <div
                      key={row.key}
                      title={row.status}
                      className={`flex items-center gap-2 rounded-xl border px-2 py-2 transition-colors ${
                        on ? 'border-violet/25 bg-raised' : 'border-line/80 bg-ink hover:bg-well/50'
                      } ${row.disabled ? 'opacity-50' : ''}`}
                    >
                      <div
                        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${
                          on
                            ? 'border-violet/30 bg-accent-br text-white shadow-[0_2px_10px_rgba(168,85,247,0.35)]'
                            : 'border-line bg-card text-fog/50'
                        }`}
                      >
                        <RowIcon className="h-3.5 w-3.5" />
                      </div>
                      <div className={`min-w-0 flex-1 text-[11px] font-medium leading-tight ${on ? 'text-paper' : 'text-fog'}`}>
                        {row.label}
                      </div>
                      <Lever checked={row.checked} onChange={row.set} disabled={row.disabled} label={row.label} />
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Timing */}
          <div className="px-3.5 pb-1.5 pt-1.5">
            <div className="grid grid-cols-2 items-center gap-x-4 gap-y-2 rounded-xl border border-line/60 bg-ink p-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fog/50">
                  <Timer className="h-3 w-3" /> Countdown
                </span>
                <div className="flex items-center gap-1">
                  {COUNTDOWNS.map((c) => (
                    <button
                      key={c}
                      onClick={() => update({ countdown: c })}
                      aria-pressed={recording.countdown === c}
                      className={`rounded-full border px-2.5 py-1 font-mono text-[10px] transition-all ${
                        recording.countdown === c
                          ? 'border-paper bg-paper text-black shadow-[0_1px_6px_rgba(255,255,255,0.2)]'
                          : 'border-line bg-transparent text-fog/60 hover:border-line-strong hover:text-fog'
                      }`}
                    >
                      {c === 0 ? 'Off' : `${c}s`}
                    </button>
                  ))}
                </div>
              </div>

              {isFeatureEnabled('SCHEDULED_RECORDING') && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fog/50">
                      <Clock className="h-3 w-3" /> Start
                    </span>
                    <div className="flex items-center gap-1">
                      {(
                        [
                          { id: 'now', label: 'Now' },
                          { id: 'in', label: 'In…' },
                          { id: 'at', label: 'At…' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setScheduleMode(m.id)}
                          aria-pressed={scheduleMode === m.id}
                          className={`rounded-full border px-2.5 py-1 font-mono text-[10px] transition-all ${
                            scheduleMode === m.id
                              ? 'border-violet/30 bg-raised text-paper'
                              : 'border-line bg-transparent text-fog/60 hover:text-fog'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {scheduleMode === 'in' && (
                    <label className="flex items-center justify-end gap-2 font-mono text-[10px] text-fog">
                      in
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={startInMin}
                        onChange={(e) => setStartInMin(Math.max(1, Number(e.target.value)))}
                        className="field w-16 rounded-full text-center"
                      />
                      min
                    </label>
                  )}
                  {scheduleMode === 'at' && (
                    <label className="flex items-center justify-end gap-2 font-mono text-[10px] text-fog">
                      at
                      <input
                        type="time"
                        value={startAtTime}
                        onChange={(e) => setStartAtTime(e.target.value)}
                        className="field rounded-full [color-scheme:dark]"
                      />
                    </label>
                  )}
                  <label className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fog/50">Auto-stop</span>
                    <select
                      value={recording.schedule.stopAfterMin ?? ''}
                      onChange={(e) =>
                        update({
                          schedule: {
                            ...recording.schedule,
                            stopAfterMin: e.target.value ? Number(e.target.value) : null,
                          },
                        })
                      }
                      className="rounded-full border border-line bg-card px-2.5 py-1 font-mono text-[10px] text-fog focus:outline-none"
                    >
                      <option value="">No limit</option>
                      {[1, 5, 10, 15, 30, 60, 120].map((m) => (
                        <option key={m} value={m}>
                          After {m} min
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          </div>

          </div>

          {/* Start */}
          <div className="flex-shrink-0 px-3.5 pb-2.5 pt-2">
            <button
              onClick={start}
              disabled={starting}
              className="group relative h-10 w-full overflow-hidden rounded-full transition-transform duration-150 active:scale-[0.98] disabled:opacity-60"
            >
              <span className="absolute inset-0 bg-accent" />
              <span
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition-opacity duration-700 group-hover:animate-shimmer group-hover:opacity-100"
                style={{ backgroundSize: '200% 100%' }}
              />
              <span className="absolute inset-[1px] flex items-center justify-center gap-2.5 rounded-full bg-accent-b">
                <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/15 to-transparent" />
                <span className="relative h-2 w-2 rounded-full bg-white shadow-[0_0_10px_white]" />
                <span className="relative text-[13px] font-bold uppercase tracking-[0.06em] text-white">
                  {scheduleMode === 'now' ? 'Start recording' : 'Schedule recording'}
                </span>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="relative flex flex-shrink-0 items-center justify-between border-t border-line/50 px-3.5 py-2 font-mono text-[10px] text-fog/50">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3 w-3" /> All local. No account. No upload.
        </span>
        <a
          href="https://www.apoorveverma.com"
          target="_blank"
          rel="noreferrer"
          className="rounded-sm transition-colors hover:text-paper focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-violet"
        >
          Built by Apoorve Verma
        </a>
      </div>
    </div>
  );
}
