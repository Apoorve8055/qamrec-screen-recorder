import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorData } from '../recorder/RecorderPage';
import type { DeepPartial, EffectsSettings, Point, Range, ZoomRegion } from '../shared/types';
import { deepMerge, persistableEffects } from '../shared/settings';
import { loadState, nextFileCounter, saveState } from '../shared/storage';
import { buildFilename } from '../shared/filename';
import { resolutionLabel } from '../shared/resolution';
import { buildScene } from '../effects/scene';
import { getBackgroundBlur } from '../effects/webcamBlur';
import { detectSilences, type SilenceOptions } from '../analysis/silence';
import { exportRecording } from '../export/exporter';
import { downloadBlob } from '../utils/download';
import { formatDuration, formatFileSize } from '../utils/format';
import { PauseIcon, PlayIcon, ScissorsIcon, ZoomIcon, DownloadIcon } from '../components/Icons';
import { hasPointerTracking, type Project } from './project';
import { PreviewPlayer, type PreviewHandle } from './PreviewPlayer';
import { TimelineView } from './TimelineView';
import { SettingsPanel, type BlurState } from './SettingsPanel';
import { addCut, keptSegments, outputDuration, removeCutAt, setTrim, sourceToOutput } from './timeline';

const SETTINGS_SAVE_DELAY_MS = 500;

export function Editor({ data }: { data: EditorData }) {
  const [project, setProject] = useState<Project>(data.project);
  const scene = useMemo(() => buildScene(project), [project]);
  const playerRef = useRef<PreviewHandle>(null);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Range | null>(null);
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
  const [blurState, setBlurState] = useState<BlurState>('off');
  const [silence, setSilence] = useState<SilenceOptions>({ thresholdDb: -45, minSilenceMs: 1200, paddingMs: 200 });
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const mainUrl = useMemo(() => URL.createObjectURL(data.mainBlob), [data.mainBlob]);
  const webcamUrl = useMemo(() => (data.webcamBlob ? URL.createObjectURL(data.webcamBlob) : null), [data.webcamBlob]);
  useEffect(
    () => () => {
      URL.revokeObjectURL(mainUrl);
      if (webcamUrl) URL.revokeObjectURL(webcamUrl);
    },
    [mainUrl, webcamUrl]
  );

  const { duration, settings } = project;
  const hasTracking = hasPointerTracking(project);
  const hasWebcam = project.webcamOffsetMs !== null;

  // Remember the look for next time, once the user actually changes it
  useEffect(() => {
    if (settings === data.project.settings) return;
    const saved = persistableEffects(settings, data.baseEffects, data.recording);
    const id = window.setTimeout(() => saveState({ effects: saved }), SETTINGS_SAVE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [settings, data]);

  useEffect(() => {
    if (!settings.webcam.backgroundBlur) {
      setBlurState('off');
      return;
    }
    setBlurState('loading');
    getBackgroundBlur().then((b) => setBlurState(b ? 'ready' : 'unavailable'));
  }, [settings.webcam.backgroundBlur]);

  const updateSettings = useCallback((patch: DeepPartial<EffectsSettings>) => {
    setProject((p) => ({ ...p, settings: deepMerge(p.settings, patch) }));
  }, []);

  const seek = useCallback((t: number) => playerRef.current?.seek(t), []);

  /* ---------------- Zoom keyframes ---------------- */

  const selectedZoom =
    scene.regions.find((r) => r.id === selectedZoomId) ?? project.manualZooms.find((r) => r.id === selectedZoomId) ?? null;

  const changeZoom = useCallback((r: ZoomRegion) => {
    if (r.source === 'auto') {
      // Editing an automatic zoom turns it into a manual keyframe (stable id, so drags update one copy)
      const manual: ZoomRegion = { ...r, id: `${r.id}-m`, source: 'manual' };
      setSelectedZoomId(manual.id);
      setProject((p) => ({
        ...p,
        suppressedZoomIds: p.suppressedZoomIds.includes(r.id) ? p.suppressedZoomIds : [...p.suppressedZoomIds, r.id],
        manualZooms: [...p.manualZooms.filter((m) => m.id !== manual.id), manual],
      }));
      return;
    }
    setProject((p) => ({ ...p, manualZooms: p.manualZooms.map((m) => (m.id === r.id ? r : m)) }));
  }, []);

  const deleteZoom = useCallback((id: string) => {
    setProject((p) =>
      p.manualZooms.some((m) => m.id === id)
        ? { ...p, manualZooms: p.manualZooms.filter((m) => m.id !== id) }
        : { ...p, suppressedZoomIds: [...p.suppressedZoomIds, id] }
    );
    setSelectedZoomId(null);
  }, []);

  const addZoom = useCallback(() => {
    const start = Math.max(0, Math.min(time, duration - 500));
    const region: ZoomRegion = {
      id: `manual-${Date.now()}`,
      start,
      end: Math.min(duration, start + settings.zoom.duration + settings.zoom.transitionMs),
      scale: settings.zoom.intensity,
      focus: scene.cursorAt(time) ?? { x: 0.5, y: 0.5 },
      source: 'manual',
    };
    setProject((p) => ({ ...p, manualZooms: [...p.manualZooms, region] }));
    setSelectedZoomId(region.id);
  }, [time, duration, settings.zoom, scene]);

  const pickFocus = useCallback(
    (focus: Point) => {
      if (selectedZoom) changeZoom({ ...selectedZoom, focus });
    },
    [selectedZoom, changeZoom]
  );

  /* ---------------- Cuts ---------------- */

  const cutSelection = useCallback(() => {
    if (!selection || selection.end - selection.start < 50) return;
    setProject((p) => ({ ...p, cuts: addCut(p.cuts, selection, p.duration) }));
    setSelection(null);
  }, [selection]);

  const silences = useMemo(() => {
    const found = detectSilences(data.analysis.envelope, data.analysis.envelopeWindowMs, silence);
    // The envelope's last window runs past the end; clamp rather than drop trailing silence
    return found
      .map((s) => ({ start: s.start, end: Math.min(s.end, duration) }))
      .filter((s) => s.end > s.start);
  }, [data.analysis, silence, duration]);

  const removeSilences = () => {
    setProject((p) => ({ ...p, cuts: silences.reduce((cuts, s) => addCut(cuts, s, p.duration), p.cuts) }));
    setNotice(`Cut ${silences.length} silence(s).`);
  };

  const keepHighlights = () => {
    // Everything outside the highlights becomes a cut
    setProject((p) => ({ ...p, cuts: keptSegments(p.duration, p.highlights) }));
    setNotice('Kept only the highlights. Click a cut in the timeline to restore it.');
  };

  /* ---------------- Export ---------------- */

  const filenameFor = (counter: number, ext: string) =>
    buildFilename(
      settings.export.filenameTemplate,
      {
        date: data.recordedAt,
        title: project.title,
        mode: project.mode,
        durationMs: outputDuration(duration, project.cuts),
        resolution: resolutionLabel(settings.export.resolution),
        counter,
      },
      ext
    );

  const doExport = async () => {
    playerRef.current?.pause();
    const controller = new AbortController();
    abortRef.current = controller;
    setExportProgress(0);
    setNotice(null);
    try {
      const blob = await exportRecording({
        scene,
        mainBlob: data.mainBlob,
        webcamBlob: data.webcamBlob,
        format: settings.export.format,
        resolution: settings.export.resolution,
        fps: settings.export.fps,
        onProgress: setExportProgress,
        signal: controller.signal,
      });
      const name = filenameFor(await nextFileCounter(), settings.export.format);
      await downloadBlob(blob, name);
      setNotice(`Saved ${name} (${formatFileSize(blob.size)})`);
    } catch (err) {
      const e = err as Error;
      setNotice(e.name === 'AbortError' ? 'Export canceled.' : `Export failed: ${e.message}`);
    } finally {
      setExportProgress(null);
      abortRef.current = null;
    }
  };

  const saveOriginal = async () => {
    const name = filenameFor(await nextFileCounter(), 'webm');
    await downloadBlob(data.mainBlob, name);
    setNotice(`Saved ${name}`);
  };

  const savePreset = async (name: string) => {
    const stored = await loadState();
    const preset = {
      id: `user-${Date.now()}`,
      name: name.trim() || 'My look',
      builtin: false,
      recording: {},
      effects: settings,
    };
    await saveState({ userPresets: [...stored.userPresets, preset], activePresetId: preset.id });
    setNotice(`Saved preset “${preset.name}”.`);
  };

  /* ---------------- Keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, select, textarea')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        playerRef.current?.toggle();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection) cutSelection();
        else if (selectedZoomId) deleteZoom(selectedZoomId);
      } else if (e.key === 'z' || e.key === 'Z') {
        addZoom();
      } else if (e.key === 'Escape') {
        setSelection(null);
        setSelectedZoomId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, selectedZoomId, cutSelection, deleteZoom, addZoom]);

  const outDuration = outputDuration(duration, project.cuts);

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-gray-800 bg-gray-900 px-4 py-2">
        <h1 className="font-semibold">Qamrec</h1>
        <span className="truncate text-xs text-gray-400">
          {project.title || 'Recording'} · {formatDuration(outDuration)}
          {outDuration < duration && <span className="text-gray-500"> (of {formatDuration(duration)})</span>}
        </span>
        {notice && <span className="ml-4 truncate text-xs text-green-400">{notice}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-secondary px-3 py-1 text-xs" onClick={() => window.close()}>
            Close
          </button>
          <button
            className="btn-primary flex items-center gap-1 px-3 py-1 text-xs"
            onClick={doExport}
            disabled={exportProgress !== null}
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            Export {settings.export.format.toUpperCase()}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 p-4">
            <PreviewPlayer
              ref={playerRef}
              scene={scene}
              mainUrl={mainUrl}
              webcamUrl={webcamUrl}
              selectedZoom={selectedZoom}
              onTime={setTime}
              onPlayingChange={setPlaying}
              onPickFocus={pickFocus}
              onWebcamMove={(x, y) => updateSettings({ webcam: { x, y } })}
            />
          </div>

          {/* Transport */}
          <div className="flex items-center gap-2 border-t border-gray-800 bg-gray-900 px-4 py-2 text-xs">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600"
              onClick={() => playerRef.current?.toggle()}
              title="Play/Pause (Space)"
            >
              {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
            </button>
            <span className="w-28 font-mono text-gray-300">
              {formatDuration(sourceToOutput(time, duration, project.cuts))} / {formatDuration(outDuration)}
            </span>
            <button
              className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 hover:bg-gray-700 disabled:opacity-40"
              disabled={!selection}
              onClick={cutSelection}
              title="Cut the selected range (Delete)"
            >
              <ScissorsIcon /> Cut selection
            </button>
            <button
              className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 hover:bg-gray-700"
              onClick={addZoom}
              title="Add a zoom keyframe at the playhead (Z)"
            >
              <ZoomIcon /> Add zoom
            </button>
            <span className="ml-auto text-gray-500">
              Drag on the clip to select · yellow handles trim · drag zoom blocks to retime
            </span>
          </div>

          <TimelineView
            scene={scene}
            time={time}
            envelope={data.analysis.envelope}
            envelopeWindowMs={data.analysis.envelopeWindowMs}
            selection={selection}
            selectedZoomId={selectedZoomId}
            onSeek={seek}
            onSelection={setSelection}
            onSelectZoom={setSelectedZoomId}
            onChangeZoom={changeZoom}
            onRestoreZoom={(id) =>
              setProject((p) => ({ ...p, suppressedZoomIds: p.suppressedZoomIds.filter((s) => s !== id) }))
            }
            onTrim={(start, end) => setProject((p) => ({ ...p, cuts: setTrim(p.cuts, p.duration, start, end) }))}
            onRestoreCut={(t) => setProject((p) => ({ ...p, cuts: removeCutAt(p.cuts, t) }))}
          />
        </div>

        <aside className="w-80 flex-shrink-0 border-l border-gray-800">
          <SettingsPanel
            project={project}
            hasTracking={hasTracking}
            hasWebcam={hasWebcam}
            blurState={blurState}
            selectedZoom={selectedZoom}
            onSettings={updateSettings}
            onZoomChange={changeZoom}
            onZoomDelete={deleteZoom}
            onAddZoom={addZoom}
            onRestoreAutoZooms={() => setProject((p) => ({ ...p, suppressedZoomIds: [] }))}
            silence={silence}
            onSilenceChange={setSilence}
            silenceFound={{ count: silences.length, totalMs: silences.reduce((s, r) => s + r.end - r.start, 0) }}
            onRemoveSilences={removeSilences}
            onKeepHighlights={keepHighlights}
            onClearCuts={() => setProject((p) => ({ ...p, cuts: [] }))}
            onChapterRename={(i, title) =>
              setProject((p) => ({ ...p, chapters: p.chapters.map((c, j) => (j === i ? { ...c, title } : c)) }))
            }
            onChapterDelete={(i) => setProject((p) => ({ ...p, chapters: p.chapters.filter((_, j) => j !== i) }))}
            onChapterAdd={() =>
              setProject((p) => ({
                ...p,
                chapters: [...p.chapters, { t: time, title: `Chapter ${p.chapters.length + 1}` }].sort((a, b) => a.t - b.t),
              }))
            }
            onSeek={seek}
            filenamePreview={filenameFor(1, settings.export.format)}
            exporting={exportProgress !== null}
            onExport={doExport}
            onSaveOriginal={saveOriginal}
            onSavePreset={savePreset}
          />
        </aside>
      </div>

      {/* Export progress */}
      {exportProgress !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="w-80 rounded-lg bg-gray-800 p-6 text-center">
            <p className="mb-3 font-medium">
              Rendering {settings.export.format.toUpperCase()}… {Math.round(exportProgress * 100)}%
            </p>
            <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-gray-700">
              <div className="h-full bg-primary-500 transition-[width]" style={{ width: `${exportProgress * 100}%` }} />
            </div>
            <button className="btn-secondary text-sm" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
