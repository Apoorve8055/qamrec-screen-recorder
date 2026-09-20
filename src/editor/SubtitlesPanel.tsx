import { useEffect, useRef } from 'react';
import type { DeepPartial, EffectsSettings, SubtitleCue, SubtitleModel } from '../shared/types';
import type { Project } from './project';
import { ColorInput, Section, Segmented, Slider, Toggle } from '../components/ui';
import { SUBTITLE_LANGUAGES, type TranscribeStatus } from '../subtitles/transcriber';
import { subtitleAt } from '../subtitles/subtitles';
import { formatDuration, formatFileSize } from '../utils/format';

export type SubtitleJob = TranscribeStatus | { stage: 'starting' };

export interface SubtitleActions {
  job: SubtitleJob | null;
  time: number;
  selectedCueId: string | null;
  onSelectCue: (id: string | null) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onCueChange: (cue: SubtitleCue) => void;
  onCueDelete: (id: string) => void;
  onCueAdd: () => void;
  onCueSplit: (id: string) => void;
  onCueMerge: (id: string) => void;
  onShift: (deltaMs: number) => void;
  onImport: (file: File) => void;
  onDownload: (format: 'srt' | 'vtt') => void;
  onClear: () => void;
  onSeek: (t: number) => void;
}

interface Props extends SubtitleActions {
  project: Project;
  onSettings: (patch: DeepPartial<EffectsSettings>) => void;
}

/** mm:ss.t */
const cueTime = (ms: number) => `${formatDuration(ms)}.${Math.floor((ms % 1000) / 100)}`;

const MODELS: { value: SubtitleModel; label: string; title: string }[] = [
  { value: 'tiny', label: 'Fast', title: 'Whisper tiny: smallest download, least accurate' },
  { value: 'base', label: 'Balanced', title: 'Whisper base: good accuracy for clear speech' },
  { value: 'small', label: 'Accurate', title: 'Whisper small: most accurate, larger download and slower' },
];

function jobLabel(job: SubtitleJob): { text: string; fraction: number | null } {
  if (job.stage === 'starting') return { text: 'Preparing audio…', fraction: null };
  if (job.stage === 'loading') {
    return job.total
      ? {
          text: `Downloading speech model… ${formatFileSize(job.loaded)} / ${formatFileSize(job.total)}`,
          fraction: job.loaded / job.total,
        }
      : { text: 'Loading speech model…', fraction: null };
  }
  return {
    text: `Transcribing on ${job.device === 'webgpu' ? 'GPU' : 'CPU'}… ${Math.round(job.fraction * 100)}%`,
    fraction: job.fraction,
  };
}

export function SubtitlesPanel(props: Props) {
  const { project, onSettings, job } = props;
  const s = project.settings.subtitles;
  const cues = project.subtitles;
  // Only Matroska-based containers (WebM) can carry a soft WebVTT track; MP4 and GIF cannot
  const canEmbedTrack = project.settings.export.format === 'webm';
  const busy = job !== null;
  const selected = cues.find((c) => c.id === props.selectedCueId) ?? null;
  const active = subtitleAt(cues, props.time);
  const rowRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const fileRef = useRef<HTMLInputElement>(null);

  // Bring the selected cue into view; put the cursor in new (empty) cues
  useEffect(() => {
    if (!props.selectedCueId) return;
    const el = rowRefs.current.get(props.selectedCueId);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    if (!el.value) el.focus();
  }, [props.selectedCueId]);

  const progress = job ? jobLabel(job) : null;

  return (
    <>
      <Section title="Generate from audio">
        <label className="flex items-center justify-between py-1 text-sm text-gray-200">
          Language
          <select
            value={s.language}
            disabled={busy}
            onChange={(e) => onSettings({ subtitles: { language: e.target.value } })}
            className="w-40 field rounded-full"
          >
            {SUBTITLE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <Segmented
          value={s.model}
          disabled={busy}
          onChange={(v) => onSettings({ subtitles: { model: v } })}
          options={MODELS}
        />
        <p className="text-xs text-gray-500">
          Runs privately on your device with the open-source Whisper model. The model downloads once and is cached; your
          audio is never uploaded.
        </p>
        {progress ? (
          <div className="pt-1">
            <p className="mb-1 text-xs text-gray-300">{progress.text}</p>
            <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
              <div
                className={`h-full bg-accent transition-[width] ${progress.fraction === null ? 'w-1/3 animate-pulse' : ''}`}
                style={progress.fraction === null ? undefined : { width: `${progress.fraction * 100}%` }}
              />
            </div>
            <button className="btn-pill w-full justify-center" onClick={props.onCancel}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="btn-accent mt-1 h-9 w-full text-[12px]"
            onClick={props.onGenerate}
          >
            {cues.length ? `Regenerate (replaces ${cues.length})` : 'Generate subtitles'}
          </button>
        )}
      </Section>

      <Section title="Style">
        <Toggle
          lead
          label="Show on video"
          hint="Burned into the preview and export"
          checked={s.show}
          onChange={(v) => onSettings({ subtitles: { show: v } })}
        />
        <Segmented
          value={s.position}
          onChange={(v) => onSettings({ subtitles: { position: v } })}
          options={[
            { value: 'bottom', label: 'Bottom' },
            { value: 'top', label: 'Top' },
          ]}
        />
        <Slider
          label="Text size"
          value={s.fontSize}
          min={24}
          max={80}
          step={1}
          format={(v) => `${v}px`}
          onChange={(v) => onSettings({ subtitles: { fontSize: v } })}
        />
        <ColorInput label="Text color" value={s.textColor} onChange={(v) => onSettings({ subtitles: { textColor: v } })} />
        <Toggle
          label="Background box"
          hint="Otherwise an outline"
          checked={s.background}
          onChange={(v) => onSettings({ subtitles: { background: v } })}
        />
        <Slider
          label="Line length"
          value={s.maxChars}
          min={24}
          max={60}
          step={1}
          format={(v) => `${v} chars`}
          onChange={(v) => onSettings({ subtitles: { maxChars: v } })}
        />
        <Toggle
          label="Embed subtitle track"
          hint={
            canEmbedTrack
              ? 'WebM: a track viewers can turn on or off'
              : `${project.settings.export.format.toUpperCase()} can't carry one — export WebM, or burn the captions in above`
          }
          checked={s.embedTrack && canEmbedTrack}
          disabled={!canEmbedTrack}
          onChange={(v) => onSettings({ subtitles: { embedTrack: v } })}
        />
      </Section>

      <Section
        title={`Subtitles (${cues.length})`}
        action={
          <button className="font-mono text-[10px] text-violet hover:text-paper disabled:opacity-40" disabled={busy} onClick={props.onCueAdd}>
            + At playhead
          </button>
        }
      >
        {selected && !busy && (
          <div className="mb-2 grid grid-cols-2 gap-1 rounded-md bg-gray-800/60 p-1.5">
            <button
              className="rounded-full border border-line bg-card py-1 font-mono text-[10px] text-fog hover:border-line-strong hover:text-paper"
              onClick={() => props.onCueChange({ ...selected, start: Math.min(props.time, selected.end - 200) })}
            >
              Start at playhead
            </button>
            <button
              className="rounded-full border border-line bg-card py-1 font-mono text-[10px] text-fog hover:border-line-strong hover:text-paper"
              onClick={() => props.onCueChange({ ...selected, end: Math.max(props.time, selected.start + 200) })}
            >
              End at playhead
            </button>
            <button
              className="rounded-full border border-line bg-card py-1 font-mono text-[10px] text-fog hover:border-line-strong hover:text-paper"
              onClick={() => props.onCueSplit(selected.id)}
            >
              Split at playhead
            </button>
            <button
              className="rounded-full border border-line bg-card py-1 font-mono text-[10px] text-fog hover:border-line-strong hover:text-paper"
              onClick={() => props.onCueMerge(selected.id)}
            >
              Merge with next
            </button>
          </div>
        )}
        {cues.length === 0 ? (
          <p className="text-xs text-gray-500">
            No subtitles yet. Generate them from the audio, import an SRT/VTT file, or add one at the playhead.
          </p>
        ) : (
          <div className={`max-h-80 space-y-1 overflow-y-auto pr-1 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            {cues.map((c) => (
              <div
                key={c.id}
                className={`flex items-start gap-1.5 rounded p-1 ${
                  c.id === props.selectedCueId ? 'bg-gray-800 ring-1 ring-violet/60' : c.id === active?.id ? 'bg-gray-800/60' : ''
                }`}
              >
                <button
                  className="w-12 pt-0.5 text-left font-mono text-[10px] leading-tight text-gray-400 hover:text-white"
                  title="Select and jump here"
                  onClick={() => {
                    props.onSelectCue(c.id);
                    props.onSeek(c.start);
                  }}
                >
                  {cueTime(c.start)}
                  <br />
                  <span className="text-gray-600">{cueTime(c.end)}</span>
                </button>
                <textarea
                  ref={(el) => {
                    if (el) rowRefs.current.set(c.id, el);
                    else rowRefs.current.delete(c.id);
                  }}
                  value={c.text}
                  rows={2}
                  placeholder="Subtitle text"
                  onFocus={() => props.onSelectCue(c.id)}
                  onChange={(e) => props.onCueChange({ ...c, text: e.target.value })}
                  className="min-w-0 flex-1 resize-none rounded-md border border-line bg-deep px-1.5 py-0.5 text-xs text-paper focus:border-violet/60 focus:outline-none"
                />
                <button
                  className="pt-0.5 text-xs text-gray-500 hover:text-paper"
                  title="Delete subtitle"
                  onClick={() => props.onCueDelete(c.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {cues.length > 0 && !busy && (
          <div className="flex items-center justify-between pt-1 text-xs text-gray-400">
            <span>Shift all</span>
            <div className="flex gap-1">
              {[-500, -100, 100, 500].map((d) => (
                <button
                  key={d}
                  className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] hover:bg-gray-700 hover:text-white"
                  onClick={() => props.onShift(d)}
                >
                  {d > 0 ? '+' : '−'}
                  {Math.abs(d) / 1000}s
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Files">
        <input
          ref={fileRef}
          type="file"
          accept=".srt,.vtt,text/vtt,application/x-subrip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void props.onImport(file);
            e.target.value = '';
          }}
        />
        <div className="grid grid-cols-3 gap-1">
          <button
            className="btn-pill justify-center"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Import
          </button>
          <button
            className="btn-pill justify-center"
            disabled={!cues.length}
            onClick={() => props.onDownload('srt')}
          >
            .srt
          </button>
          <button
            className="btn-pill justify-center"
            disabled={!cues.length}
            onClick={() => props.onDownload('vtt')}
          >
            .vtt
          </button>
        </div>
        <p className="text-xs text-gray-500">Downloads match the edited video (cuts and trims applied).</p>
        {cues.length > 0 && !busy && (
          <button className="text-xs text-gray-400 hover:text-paper" onClick={props.onClear}>
            Delete all subtitles
          </button>
        )}
      </Section>
    </>
  );
}
