import { useState, type ComponentType } from 'react';
import { Camera, Captions, Frame, MousePointer2, Scissors, Upload, ZoomIn, type LucideProps } from 'lucide-react';
import type { DeepPartial, EffectsSettings, ExportFormat, ExportResolution, WebcamShape, ZoomRegion } from '../shared/types';
import type { Project } from './project';
import { ColorInput, Section, Segmented, Slider, Toggle } from '../components/ui';
import { BACKGROUNDS } from '../effects/compositor';
import { FEATURES } from '../config/features';
import { FILENAME_TOKENS } from '../shared/filename';
import { formatDuration } from '../utils/format';
import type { SilenceOptions } from '../analysis/silence';
import { SubtitlesPanel, type SubtitleActions } from './SubtitlesPanel';

export type BlurState = 'off' | 'loading' | 'ready' | 'unavailable';
type Tab = 'zoom' | 'cursor' | 'camera' | 'frame' | 'edit' | 'subtitles' | 'export';

interface Props {
  project: Project;
  hasTracking: boolean;
  hasWebcam: boolean;
  blurState: BlurState;
  selectedZoom: ZoomRegion | null;
  onSettings: (patch: DeepPartial<EffectsSettings>) => void;
  onZoomChange: (r: ZoomRegion) => void;
  onZoomDelete: (id: string) => void;
  onAddZoom: () => void;
  onRestoreAutoZooms: () => void;
  silence: SilenceOptions;
  onSilenceChange: (s: SilenceOptions) => void;
  silenceFound: { count: number; totalMs: number };
  onRemoveSilences: () => void;
  onKeepHighlights: () => void;
  onClearCuts: () => void;
  onChapterRename: (index: number, title: string) => void;
  onChapterDelete: (index: number) => void;
  onChapterAdd: () => void;
  onSeek: (t: number) => void;
  filenamePreview: string;
  exporting: boolean;
  onExport: () => void;
  onSaveOriginal: () => void;
  onSavePreset: (name: string) => void;
  subtitles: SubtitleActions;
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function SettingsPanel(props: Props) {
  const { project, onSettings } = props;
  const s = project.settings;
  const [tab, setTab] = useState<Tab>('zoom');
  const [presetName, setPresetName] = useState('');

  const tabs: { id: Tab; label: string; icon: ComponentType<LucideProps> }[] = [
    { id: 'zoom', label: 'Zoom', icon: ZoomIn },
    { id: 'cursor', label: 'Cursor', icon: MousePointer2 },
    { id: 'camera', label: 'Camera', icon: Camera },
    { id: 'frame', label: 'Frame', icon: Frame },
    { id: 'edit', label: 'Edit', icon: Scissors },
    ...(FEATURES.SUBTITLES ? [{ id: 'subtitles' as const, label: 'Subtitles', icon: Captions }] : []),
    { id: 'export', label: 'Export', icon: Upload },
  ];

  const formats: { value: ExportFormat; label: string }[] = [
    ...(FEATURES.MP4_EXPORT ? [{ value: 'mp4' as const, label: 'MP4' }] : []),
    { value: 'webm', label: 'WebM' },
    ...(FEATURES.GIF_EXPORT ? [{ value: 'gif' as const, label: 'GIF' }] : []),
  ];

  return (
    <div className="flex h-full flex-col bg-ink">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-line px-2 py-2">
        {tabs.map((t) => {
          const TabIcon = t.icon;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`flex h-7 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
                tab === t.id
                  ? 'border-paper bg-paper text-ink'
                  : 'border-line bg-card text-fog hover:border-line-strong hover:text-paper'
              }`}
            >
              <TabIcon className="h-3 w-3" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'zoom' && (
          <>
            {props.selectedZoom && (
              <Section
                title={`Selected ${props.selectedZoom.source === 'auto' ? 'auto' : 'manual'} zoom`}
                action={
                  <button className="font-mono text-[10px] text-fog hover:text-paper" onClick={() => props.onZoomDelete(props.selectedZoom!.id)}>
                    Delete
                  </button>
                }
              >
                <Slider
                  label="Zoom"
                  value={props.selectedZoom.scale}
                  min={1.1}
                  max={4}
                  step={0.05}
                  format={(v) => `×${v.toFixed(2)}`}
                  onChange={(v) => props.onZoomChange({ ...props.selectedZoom!, scale: v })}
                />
                <Slider
                  label="Length"
                  value={props.selectedZoom.end - props.selectedZoom.start}
                  min={500}
                  max={15_000}
                  step={100}
                  format={sec}
                  onChange={(v) =>
                    props.onZoomChange({
                      ...props.selectedZoom!,
                      end: Math.min(project.duration, props.selectedZoom!.start + v),
                    })
                  }
                />
                <Toggle
                  label="Follow cursor"
                  hint={props.selectedZoom.focus ? 'Click the preview to move the focus point' : undefined}
                  checked={props.selectedZoom.focus === null}
                  onChange={(follow) =>
                    props.onZoomChange({ ...props.selectedZoom!, focus: follow ? null : { x: 0.5, y: 0.5 } })
                  }
                />
              </Section>
            )}
            <Section
              title="Automatic zoom"
              action={
                <button className="font-mono text-[10px] text-violet hover:text-paper" onClick={props.onAddZoom}>
                  + Zoom at playhead
                </button>
              }
            >
              {!project.cameraOnly && !props.hasTracking && (
                <p className="mb-1 text-xs text-gray-500">
                  No page tracking in this recording — zooms come from smart auto-framing of on-screen activity.
                </p>
              )}
              <Toggle lead label="Auto zoom" checked={s.zoom.auto} onChange={(v) => onSettings({ zoom: { auto: v } })} />
              <Slider
                label="Intensity"
                value={s.zoom.intensity}
                min={1.25}
                max={3}
                step={0.05}
                format={(v) => `×${v.toFixed(2)}`}
                onChange={(v) => onSettings({ zoom: { intensity: v } })}
              />
              <Slider
                label="Hold duration"
                value={s.zoom.duration}
                min={800}
                max={6000}
                step={100}
                format={sec}
                onChange={(v) => onSettings({ zoom: { duration: v } })}
              />
              <Slider
                label="Transition"
                value={s.zoom.transitionMs}
                min={250}
                max={1500}
                step={50}
                format={sec}
                onChange={(v) => onSettings({ zoom: { transitionMs: v } })}
              />
              <Toggle
                label="Follow the action"
                hint="Pan smoothly with the cursor while zoomed"
                checked={s.zoom.followCursor}
                onChange={(v) => onSettings({ zoom: { followCursor: v } })}
              />
              <Toggle
                label="Typing focus"
                hint="Frame the field being typed into"
                checked={s.zoom.typingFocus}
                onChange={(v) => onSettings({ zoom: { typingFocus: v } })}
              />
              {project.suppressedZoomIds.length > 0 && (
                <button className="text-xs text-gray-400 hover:text-white" onClick={props.onRestoreAutoZooms}>
                  Restore {project.suppressedZoomIds.length} deleted auto zoom(s)
                </button>
              )}
            </Section>
          </>
        )}

        {tab === 'cursor' && (
          <>
            <Section title="Cursor">
              {!props.hasTracking && <p className="text-xs text-gray-500">Cursor effects need page tracking (record “This tab”).</p>}
              <Toggle lead label="Highlight" checked={s.cursor.highlight} onChange={(v) => onSettings({ cursor: { highlight: v } })} />
              <ColorInput label="Highlight color" value={s.cursor.highlightColor} onChange={(v) => onSettings({ cursor: { highlightColor: v } })} />
              <Slider
                label="Highlight size"
                value={s.cursor.highlightSize}
                min={12}
                max={60}
                step={1}
                onChange={(v) => onSettings({ cursor: { highlightSize: v } })}
              />
              <Toggle label="Click ripples" checked={s.cursor.clickRipples} onChange={(v) => onSettings({ cursor: { clickRipples: v } })} />
              <ColorInput label="Ripple color" value={s.cursor.rippleColor} onChange={(v) => onSettings({ cursor: { rippleColor: v } })} />
              <Toggle
                label="Numbered click steps"
                hint="Tutorial-style step badges"
                checked={s.cursor.clickIndicators}
                onChange={(v) => onSettings({ cursor: { clickIndicators: v } })}
              />
              <Toggle
                label="Scroll indicator"
                checked={s.cursor.scrollIndicator}
                onChange={(v) => onSettings({ cursor: { scrollIndicator: v } })}
              />
            </Section>
            <Section title="Keystrokes">
              <Toggle
                label="Show shortcuts & keys"
                hint="Typed text is never shown; password fields are ignored"
                checked={s.keys.enabled}
                onChange={(v) => onSettings({ keys: { enabled: v } })}
              />
              <Segmented
                value={s.keys.position}
                onChange={(v) => onSettings({ keys: { position: v } })}
                options={[
                  { value: 'bottom', label: 'Bottom' },
                  { value: 'top', label: 'Top' },
                ]}
              />
            </Section>
          </>
        )}

        {tab === 'camera' && (
          <Section title="Webcam">
            {!props.hasWebcam && !project.cameraOnly ? (
              <p className="text-xs text-gray-500">This recording has no webcam. Turn on “Webcam overlay” in the popup next time.</p>
            ) : (
              <>
                {!project.cameraOnly && (
                  <>
                    <Toggle lead label="Show webcam" checked={s.webcam.visible} onChange={(v) => onSettings({ webcam: { visible: v } })} />
                    <Segmented<WebcamShape>
                      value={s.webcam.shape}
                      onChange={(v) => onSettings({ webcam: { shape: v } })}
                      options={[
                        { value: 'circle', label: 'Circle' },
                        { value: 'rounded', label: 'Rounded' },
                        { value: 'square', label: 'Square' },
                        { value: 'rectangle', label: 'Wide' },
                      ]}
                    />
                    <Slider
                      label="Size"
                      value={s.webcam.size}
                      min={0.12}
                      max={0.6}
                      step={0.01}
                      format={(v) => `${Math.round(v * 100)}%`}
                      onChange={(v) => onSettings({ webcam: { size: v } })}
                    />
                    <div className="grid grid-cols-4 gap-1 py-1">
                      {[
                        { label: '↖', x: 0.14, y: 0.2 },
                        { label: '↗', x: 0.86, y: 0.2 },
                        { label: '↙', x: 0.14, y: 0.78 },
                        { label: '↘', x: 0.86, y: 0.78 },
                      ].map((p) => (
                        <button
                          key={p.label}
                          className="rounded bg-gray-800 py-1 text-sm hover:bg-gray-700"
                          onClick={() => onSettings({ webcam: { x: p.x, y: p.y } })}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500">Tip: drag the webcam in the preview to place it anywhere.</p>
                    <Slider
                      label="Crop zoom"
                      value={s.webcam.cropZoom}
                      min={1}
                      max={2.5}
                      step={0.05}
                      format={(v) => `×${v.toFixed(2)}`}
                      onChange={(v) => onSettings({ webcam: { cropZoom: v } })}
                    />
                    <Slider label="Crop X" value={s.webcam.cropX} min={-1} max={1} step={0.05} onChange={(v) => onSettings({ webcam: { cropX: v } })} />
                    <Slider label="Crop Y" value={s.webcam.cropY} min={-1} max={1} step={0.05} onChange={(v) => onSettings({ webcam: { cropY: v } })} />
                    <Slider
                      label="Border"
                      value={s.webcam.borderWidth}
                      min={0}
                      max={16}
                      step={1}
                      format={(v) => `${v}px`}
                      onChange={(v) => onSettings({ webcam: { borderWidth: v } })}
                    />
                    <ColorInput label="Border color" value={s.webcam.borderColor} onChange={(v) => onSettings({ webcam: { borderColor: v } })} />
                    <Toggle label="Shadow" checked={s.webcam.shadow} onChange={(v) => onSettings({ webcam: { shadow: v } })} />
                  </>
                )}
                <Toggle label="Mirror" checked={s.webcam.mirror} onChange={(v) => onSettings({ webcam: { mirror: v } })} />
                {FEATURES.BACKGROUND_BLUR && (
                  <>
                    <Toggle
                      label="Background blur"
                      hint={
                        props.blurState === 'loading'
                          ? 'Loading segmentation model…'
                          : props.blurState === 'unavailable'
                            ? 'Unavailable on this device'
                            : 'Runs locally with MediaPipe'
                      }
                      checked={s.webcam.backgroundBlur}
                      onChange={(v) => onSettings({ webcam: { backgroundBlur: v } })}
                    />
                    <Slider
                      label="Blur amount"
                      value={s.webcam.blurAmount}
                      min={4}
                      max={30}
                      step={1}
                      disabled={!s.webcam.backgroundBlur}
                      format={(v) => `${v}px`}
                      onChange={(v) => onSettings({ webcam: { blurAmount: v } })}
                    />
                  </>
                )}
              </>
            )}
          </Section>
        )}

        {tab === 'frame' && (
          <Section title="Frame">
            <Slider
              label="Padding"
              value={s.frame.padding}
              min={0}
              max={0.15}
              step={0.005}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => onSettings({ frame: { padding: v } })}
            />
            <div className="grid grid-cols-7 gap-1.5 py-1">
              {Object.entries(BACKGROUNDS).map(([id, bg]) => (
                <button
                  key={id}
                  title={bg.label}
                  onClick={() => onSettings({ frame: { background: id } })}
                  className={`h-7 rounded-md ${s.frame.background === id ? 'ring-2 ring-white' : ''}`}
                  style={{ background: `linear-gradient(135deg, ${bg.stops.join(', ')})` }}
                />
              ))}
            </div>
            <Slider
              label="Corner radius"
              value={s.frame.cornerRadius}
              min={0}
              max={40}
              step={1}
              format={(v) => `${v}px`}
              onChange={(v) => onSettings({ frame: { cornerRadius: v } })}
            />
            <Toggle label="Drop shadow" checked={s.frame.shadow} onChange={(v) => onSettings({ frame: { shadow: v } })} />
            <Toggle
              label="Chapter title cards"
              hint="Show chapter names as lower-thirds"
              checked={s.frame.chapterTitles}
              onChange={(v) => onSettings({ frame: { chapterTitles: v } })}
            />
          </Section>
        )}

        {tab === 'edit' && (
          <>
            {FEATURES.SILENCE_REMOVAL && (
              <Section title="Remove silences">
                <Slider
                  label="Silence threshold"
                  value={props.silence.thresholdDb}
                  min={-70}
                  max={-20}
                  step={1}
                  format={(v) => `${v} dB`}
                  onChange={(v) => props.onSilenceChange({ ...props.silence, thresholdDb: v })}
                />
                <Slider
                  label="Minimum length"
                  value={props.silence.minSilenceMs}
                  min={300}
                  max={5000}
                  step={100}
                  format={sec}
                  onChange={(v) => props.onSilenceChange({ ...props.silence, minSilenceMs: v })}
                />
                <button
                  className="btn-pill mt-1 w-full justify-center"
                  disabled={props.silenceFound.count === 0}
                  onClick={props.onRemoveSilences}
                >
                  {props.silenceFound.count
                    ? `Cut ${props.silenceFound.count} silence(s) · ${sec(props.silenceFound.totalMs)}`
                    : 'No silences found'}
                </button>
              </Section>
            )}
            <Section title="Highlights">
              {project.highlights.length ? (
                <>
                  {project.highlights.map((h) => (
                    <button
                      key={h.start}
                      className="block w-full rounded px-1 py-0.5 text-left text-xs text-gray-300 hover:bg-gray-800"
                      onClick={() => props.onSeek(h.start)}
                    >
                      ★ {formatDuration(h.start)} – {formatDuration(h.end)}
                    </button>
                  ))}
                  <button
                    className="btn-pill mt-1 w-full justify-center"
                    onClick={props.onKeepHighlights}
                  >
                    Keep only highlights (highlight reel)
                  </button>
                </>
              ) : (
                <p className="text-xs text-gray-500">No highlights detected. Use the marker button while recording.</p>
              )}
            </Section>
            <Section
              title="Chapters"
              action={
                <button className="font-mono text-[10px] text-violet hover:text-paper" onClick={props.onChapterAdd}>
                  + At playhead
                </button>
              }
            >
              {project.chapters.map((c, i) => (
                <div key={`${c.t}-${i}`} className="flex items-center gap-2">
                  <button className="w-12 font-mono text-xs text-gray-400 hover:text-white" onClick={() => props.onSeek(c.t)}>
                    {formatDuration(c.t)}
                  </button>
                  <input
                    value={c.title}
                    onChange={(e) => props.onChapterRename(i, e.target.value)}
                    className="flex-1 rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-100"
                  />
                  <button className="text-xs text-gray-500 hover:text-paper" onClick={() => props.onChapterDelete(i)}>
                    ✕
                  </button>
                </div>
              ))}
            </Section>
            {project.cuts.length > 0 && (
              <Section title="Cuts">
                <button className="text-xs text-gray-400 hover:text-white" onClick={props.onClearCuts}>
                  Restore everything (remove all cuts &amp; trims)
                </button>
              </Section>
            )}
          </>
        )}

        {tab === 'subtitles' && FEATURES.SUBTITLES && (
          <SubtitlesPanel project={project} onSettings={onSettings} {...props.subtitles} />
        )}

        {tab === 'export' && (
          <>
            <Section title="Format">
              <Segmented value={s.export.format} onChange={(v) => onSettings({ export: { format: v } })} options={formats} />
              <label className="flex items-center justify-between py-1 text-sm text-gray-200">
                Resolution
                <select
                  value={String(s.export.resolution)}
                  onChange={(e) =>
                    onSettings({
                      export: {
                        resolution: (e.target.value === 'original' ? 'original' : Number(e.target.value)) as ExportResolution,
                      },
                    })
                  }
                  className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs"
                >
                  <option value="original">Original ({project.sourceHeight}p)</option>
                  {[2160, 1440, 1080, 720, 480]
                    .filter((r) => r < project.sourceHeight)
                    .map((r) => (
                      <option key={r} value={r}>
                        {r}p
                      </option>
                    ))}
                </select>
              </label>
              <div className="flex items-center justify-between text-sm text-gray-200">
                Frame rate
                <div className="w-40">
                  <Segmented
                    value={s.export.fps}
                    onChange={(v) => onSettings({ export: { fps: v } })}
                    options={(s.export.format === 'gif' ? [10, 12, 15] : [24, 30, 60]).map((f) => ({ value: f, label: `${f}` }))}
                  />
                </div>
              </div>
              {s.export.format === 'gif' && <p className="text-xs text-gray-500">GIFs are capped at 720p and 15 fps and have no sound.</p>}
            </Section>
            <Section title="Filename">
              <input
                value={s.export.filenameTemplate}
                onChange={(e) => onSettings({ export: { filenameTemplate: e.target.value } })}
                className="w-full rounded bg-gray-800 px-2 py-1 font-mono text-xs text-gray-100"
              />
              <div className="flex flex-wrap gap-1 py-1">
                {FILENAME_TOKENS.map((token) => (
                  <button
                    key={token}
                    className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] text-gray-400 hover:text-white"
                    onClick={() => onSettings({ export: { filenameTemplate: s.export.filenameTemplate + token } })}
                  >
                    {token}
                  </button>
                ))}
              </div>
              <p className="truncate text-xs text-gray-500">→ {props.filenamePreview}</p>
            </Section>
            <Section title="Save">
              <button
                onClick={props.onExport}
                disabled={props.exporting}
                className="btn-rec h-10 w-full justify-center text-[12px]"
              >
                Export {s.export.format.toUpperCase()}
              </button>
              <button className="mt-1 w-full text-xs text-gray-400 hover:text-white" onClick={props.onSaveOriginal}>
                Save original recording (WebM, no effects)
              </button>
            </Section>
            {FEATURES.PRESETS && (
              <Section title="Preset">
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    props.onSavePreset(presetName);
                    setPresetName('');
                  }}
                >
                  <input
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="Save this look as…"
                    className="flex-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-100"
                  />
                  <button type="submit" className="font-mono text-[10px] text-violet hover:text-paper">
                    Save
                  </button>
                </form>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
