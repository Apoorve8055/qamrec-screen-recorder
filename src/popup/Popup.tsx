import { useEffect, useState } from 'react';
import { isFeatureEnabled } from '../config/features';
import {
  ScreenIcon,
  CameraIcon,
  TabIcon,
  GithubIcon,
  GlobeIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
  MarkerIcon,
} from '../components/Icons';
import { Segmented, Toggle } from '../components/ui';
import { formatDuration } from '../utils/format';
import { BUILTIN_PRESETS, DEFAULT_EFFECTS, DEFAULT_RECORDING, applyPreset } from '../shared/settings';
import { loadState, saveState, type StoredState } from '../shared/storage';
import type { CaptureSource, ControlCommand, Preset, RecordingOptions, RecordingStatus } from '../shared/types';

type ScheduleMode = 'now' | 'in' | 'at';

/** Next epoch ms at which the wall clock reads HH:MM */
function nextTimeOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

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

  if (!stored) return <div className="min-h-[420px] bg-gray-900" />;

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
      activePresetId: 'default',
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

  const sources: { id: CaptureSource; label: string; hint: string; icon: JSX.Element; enabled: boolean }[] = [
    {
      id: 'tab',
      label: 'This tab',
      hint: tabScriptable ? 'Auto-zoom, clicks & keystrokes' : 'Page effects unavailable on this page',
      icon: <TabIcon />,
      enabled: isFeatureEnabled('TAB_RECORDING'),
    },
    {
      id: 'screen',
      label: 'Screen / window',
      hint: 'Pick a screen, window or any tab',
      icon: <ScreenIcon />,
      enabled: isFeatureEnabled('SCREEN_RECORDING'),
    },
    {
      id: 'camera',
      label: 'Camera',
      hint: 'Webcam only',
      icon: <CameraIcon />,
      enabled: isFeatureEnabled('CAMERA_RECORDING'),
    },
  ];

  return (
    <div className="bg-gray-900 min-h-[420px] text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div>
          <h1 className="text-lg font-bold text-white leading-tight">Qamrec</h1>
          <p className="text-xs text-gray-400">Cinematic screen recorder</p>
        </div>
        {isFeatureEnabled('PRESETS') && !inSession && (
          <select
            value={stored.activePresetId}
            onChange={(e) => choosePreset(e.target.value)}
            className="max-w-[9rem] rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200"
            title="Recording preset"
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-3 rounded-lg border border-red-600 bg-red-600/20 p-2 text-xs text-red-300">{error}</div>
      )}

      {inSession ? (
        <div className="px-4 py-6 text-center">
          <div
            className={`mx-auto mb-3 h-3 w-3 rounded-full ${
              status.state === 'recording' ? 'bg-red-500 recording-pulse' : 'bg-yellow-500'
            }`}
          />
          <h2 className="mb-1 text-sm font-medium text-gray-300">
            {status.state === 'armed' ? 'Getting ready…' : status.state === 'paused' ? 'Paused' : 'Recording'}
          </h2>
          <p className="mb-5 font-mono text-3xl text-white">{formatDuration(elapsed)}</p>
          {status.state !== 'armed' && (
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => control(status.state === 'paused' ? 'resume' : 'pause')}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600"
                title={status.state === 'paused' ? 'Resume' : 'Pause'}
              >
                {status.state === 'paused' ? <PlayIcon /> : <PauseIcon />}
              </button>
              <button
                onClick={() => control('stop')}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-500"
                title="Stop"
              >
                <StopIcon />
              </button>
              <button
                onClick={() => control('marker')}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600"
                title="Mark a highlight"
              >
                <MarkerIcon />
              </button>
            </div>
          )}
          <p className="mt-5 text-xs text-gray-500">Shortcuts: Alt+Shift+S stop · Alt+Shift+P pause · Alt+Shift+M marker</p>
        </div>
      ) : (
        <>
          {/* Source */}
          <div className="grid grid-cols-3 gap-2 px-4">
            {sources
              .filter((s) => s.enabled)
              .map((s) => (
                <button
                  key={s.id}
                  onClick={() => update({ source: s.id })}
                  title={s.hint}
                  className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-colors ${
                    recording.source === s.id
                      ? 'border-primary-500 bg-primary-600/20 text-white'
                      : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {s.icon}
                  <span className="text-xs font-medium">{s.label}</span>
                </button>
              ))}
          </div>
          <p className="px-4 pt-1 text-[11px] text-gray-500">{sources.find((s) => s.id === recording.source)?.hint}</p>

          {/* Options */}
          <div className="mt-2 px-4">
            {isFeatureEnabled('SCREEN_CAMERA') && (
              <Toggle
                label="Webcam overlay"
                checked={recording.webcam}
                disabled={recording.source === 'camera'}
                onChange={(v) => update({ webcam: v })}
              />
            )}
            {isFeatureEnabled('SYSTEM_AUDIO') && (
              <Toggle
                label={recording.source === 'tab' ? 'Tab audio' : 'System audio'}
                checked={recording.systemAudio}
                disabled={recording.source === 'camera'}
                onChange={(v) => update({ systemAudio: v })}
              />
            )}
            <Toggle label="Microphone" checked={recording.microphone} onChange={(v) => update({ microphone: v })} />
            <Toggle
              label="Noise reduction"
              checked={recording.noiseReduction}
              disabled={!recording.microphone}
              onChange={(v) => update({ noiseReduction: v })}
            />
            <Toggle
              label="Tutorial mode"
              hint="Numbered clicks, keystrokes, cursor highlight"
              checked={recording.tutorialMode}
              onChange={(v) => update({ tutorialMode: v })}
            />
          </div>

          <div className="mt-2 space-y-2 border-t border-gray-800 px-4 pt-3">
            <div className="flex items-center justify-between text-sm text-gray-200">
              Countdown
              <div className="w-40">
                <Segmented
                  value={recording.countdown}
                  onChange={(v) => update({ countdown: v })}
                  options={[
                    { value: 0, label: 'Off' },
                    { value: 3, label: '3s' },
                    { value: 5, label: '5s' },
                    { value: 10, label: '10s' },
                  ]}
                />
              </div>
            </div>

            {isFeatureEnabled('SCHEDULED_RECORDING') && (
              <>
                <div className="flex items-center justify-between text-sm text-gray-200">
                  Start
                  <div className="w-40">
                    <Segmented
                      value={scheduleMode}
                      onChange={setScheduleMode}
                      options={[
                        { value: 'now', label: 'Now' },
                        { value: 'in', label: 'In…' },
                        { value: 'at', label: 'At…' },
                      ]}
                    />
                  </div>
                </div>
                {scheduleMode === 'in' && (
                  <label className="flex items-center justify-end gap-2 text-xs text-gray-400">
                    in
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={startInMin}
                      onChange={(e) => setStartInMin(Math.max(1, Number(e.target.value)))}
                      className="w-16 rounded bg-gray-800 px-2 py-1 text-gray-100"
                    />
                    minutes
                  </label>
                )}
                {scheduleMode === 'at' && (
                  <label className="flex items-center justify-end gap-2 text-xs text-gray-400">
                    at
                    <input
                      type="time"
                      value={startAtTime}
                      onChange={(e) => setStartAtTime(e.target.value)}
                      className="rounded bg-gray-800 px-2 py-1 text-gray-100"
                    />
                  </label>
                )}
                <label className="flex items-center justify-between text-sm text-gray-200">
                  Auto-stop after
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
                    className="w-40 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs"
                  >
                    <option value="">No limit</option>
                    {[1, 5, 10, 15, 30, 60, 120].map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>

          <div className="px-4 pt-4">
            <button
              onClick={start}
              disabled={starting}
              className="w-full rounded-lg bg-primary-600 py-2.5 font-semibold text-white transition-colors hover:bg-primary-500 disabled:opacity-50"
            >
              {scheduleMode === 'now' ? 'Start recording' : 'Schedule recording'}
            </button>
          </div>

          {isFeatureEnabled('PRESETS') && (
            <div className="flex items-center justify-between px-4 pt-2 text-xs text-gray-400">
              {namingPreset === null ? (
                <>
                  <button className="hover:text-white" onClick={() => setNamingPreset('')}>
                    Save as preset…
                  </button>
                  {stored.userPresets.some((p) => p.id === stored.activePresetId) && (
                    <button className="hover:text-red-400" onClick={() => deletePreset(stored.activePresetId)}>
                      Delete preset
                    </button>
                  )}
                </>
              ) : (
                <form
                  className="flex w-full gap-2"
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
                    className="flex-1 rounded bg-gray-800 px-2 py-1 text-gray-100"
                  />
                  <button type="submit" className="text-primary-400 hover:text-primary-300">
                    Save
                  </button>
                </form>
              )}
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <div className="mt-4 border-t border-gray-800 px-4 py-3">
        <p className="mb-2 text-center text-[11px] text-gray-500">
          All recordings are processed and saved locally. No account, no uploads.
        </p>
        <div className="flex items-center justify-center gap-4 text-xs text-gray-400">
          <span>by Apoorve Verma</span>
          <a
            href="https://github.com/Apoorve8055/qamrec-screen-recorder"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-white transition-colors"
          >
            <GithubIcon className="w-3.5 h-3.5" />
            GitHub
          </a>
          <a
            href="https://www.apoorveverma.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-white transition-colors"
          >
            <GlobeIcon className="w-3.5 h-3.5" />
            Website
          </a>
        </div>
      </div>
    </div>
  );
}
