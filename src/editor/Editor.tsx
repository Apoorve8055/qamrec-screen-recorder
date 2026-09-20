import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorData } from '../recorder/RecorderPage';
import type { DeepPartial, EffectsSettings, Point, Range, SubtitleCue, ZoomRegion } from '../shared/types';
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
import { Pause, Play, Scissors, ShieldCheck, Upload, X, ZoomIn } from 'lucide-react';
import { hasPointerTracking, type Project } from './project';
import { PreviewPlayer, type PreviewHandle } from './PreviewPlayer';
import { TimelineView } from './TimelineView';
import { SettingsPanel, type BlurState } from './SettingsPanel';
import { addCut, keptSegments, outputDuration, outputToSource, removeCutAt, setTrim, sourceToOutput } from './timeline';
import type { SubtitleActions, SubtitleJob } from './SubtitlesPanel';
import { transcribe } from '../subtitles/transcriber';
import {
  mergeWithNext,
  newCueId,
  parseSubtitles,
  shiftCues,
  sortCues,
  splitCue,
  toSrt,
  toVtt,
} from '../subtitles/subtitles';

const SETTINGS_SAVE_DELAY_MS = 500;
/** Shortest subtitle worth adding at the playhead */
const MIN_CUE_MS = 200;

export function Editor({ data }: { data: EditorData }) {
  const [project, setProject] = useState<Project>(data.project);
  // Zooms and the camera path are expensive to build (a pass over the whole recording), so they
  // are keyed only on what buildScene reads -- editing a subtitle must not rebuild the camera
  const built = useMemo(
    () => buildScene(project),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      project.events,
      project.activity,
      project.settings.zoom,
      project.duration,
      project.cameraOnly,
      project.suppressedZoomIds,
      project.manualZooms,
    ]
  );
  // ...but everything downstream still needs the current project (subtitles, cuts, styling)
  const scene = useMemo(() => ({ ...built, project }), [built, project]);
  const playerRef = useRef<PreviewHandle>(null);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Range | null>(null);
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
  const [blurState, setBlurState] = useState<BlurState>('off');
  const [silence, setSilence] = useState<SilenceOptions>({ thresholdDb: -45, minSilenceMs: 1200, paddingMs: 200 });
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const [subtitleJob, setSubtitleJob] = useState<SubtitleJob | null>(null);
  const subtitleAbortRef = useRef<AbortController | null>(null);
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

  /* ---------------- Subtitles ---------------- */

  const setCues = useCallback((update: (cues: SubtitleCue[]) => SubtitleCue[]) => {
    setProject((p) => ({ ...p, subtitles: update(p.subtitles) }));
  }, []);

  const selectCue = useCallback((id: string | null) => {
    setSelectedCueId(id);
    if (id) setSelectedZoomId(null);
  }, []);

  const deleteCue = useCallback(
    (id: string) => {
      setCues((cues) => cues.filter((c) => c.id !== id));
      setSelectedCueId((s) => (s === id ? null : s));
    },
    [setCues]
  );

  const generateSubtitles = async () => {
    if (project.subtitles.length && !window.confirm(`Replace the ${project.subtitles.length} existing subtitles?`)) return;
    const previous = project.subtitles;
    const controller = new AbortController();
    subtitleAbortRef.current = controller;
    setSubtitleJob({ stage: 'starting' });
    setSelectedCueId(null);
    setNotice(null);
    let partial: SubtitleCue[] = [];
    try {
      const cues = await transcribe({
        blob: data.mainBlob,
        durationMs: duration,
        cuts: project.cuts,
        envelope: data.analysis.envelope,
        envelopeWindowMs: data.analysis.envelopeWindowMs,
        model: settings.subtitles.model,
        language: settings.subtitles.language,
        maxChars: settings.subtitles.maxChars,
        onStatus: setSubtitleJob,
        onPartial: (found) => {
          partial = found;
          setCues(() => found);
        },
        signal: controller.signal,
      });
      setCues(() => cues);
      setNotice(cues.length ? `Generated ${cues.length} subtitles. Review them in the Subs tab.` : 'No speech found.');
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') {
        setCues(() => (partial.length ? partial : previous));
        setNotice(partial.length ? `Stopped. Kept ${partial.length} subtitles found so far.` : 'Subtitle generation canceled.');
      } else {
        setCues(() => previous);
        setNotice(`Could not generate subtitles: ${e.message}`);
      }
    } finally {
      setSubtitleJob(null);
      subtitleAbortRef.current = null;
    }
  };

  // Stop transcribing if the editor goes away
  useEffect(() => () => subtitleAbortRef.current?.abort(), []);

  const addCue = () => {
    const next = project.subtitles.find((c) => c.start > time);
    const start = Math.min(time, Math.max(0, duration - 500));
    // Never run past the following cue: overlapping cues hide each other in the preview and export
    const end = Math.min(start + 2500, next ? next.start : duration, duration);
    if (end - start < MIN_CUE_MS) {
      setNotice('Not enough room for a subtitle here. Move the playhead further from the next one.');
      return;
    }
    const cue: SubtitleCue = { id: newCueId(), start, end, text: '' };
    setCues((cues) => sortCues([...cues, cue]));
    selectCue(cue.id);
  };

  const importSubtitles = async (file: File) => {
    let parsed: ReturnType<typeof parseSubtitles>;
    try {
      parsed = parseSubtitles(await file.text());
    } catch (e) {
      setNotice(`Could not read ${file.name}: ${(e as Error).message}`);
      return;
    }
    if (!parsed.length) {
      setNotice(`No subtitles found in ${file.name}.`);
      return;
    }
    if (project.subtitles.length && !window.confirm(`Replace the ${project.subtitles.length} existing subtitles?`)) return;
    // Files describe the edited video, so map their times back onto the recording
    // Cues that fall entirely inside a cut collapse to zero length and are dropped
    const cues = sortCues(
      parsed.map((c) => ({
        id: newCueId(),
        start: outputToSource(c.start, duration, project.cuts),
        end: outputToSource(c.end, duration, project.cuts),
        text: c.text,
      }))
    ).filter((c) => c.end > c.start);
    setCues(() => cues);
    setSelectedCueId(null);
    setNotice(`Imported ${cues.length} subtitles from ${file.name}.`);
  };

  const downloadSubtitles = async (format: 'srt' | 'vtt') => {
    const text = (format === 'srt' ? toSrt : toVtt)(project.subtitles, duration, project.cuts, settings.subtitles.maxChars);
    const name = filenameFor(await nextFileCounter(), format);
    await downloadBlob(new Blob([text], { type: format === 'srt' ? 'application/x-subrip' : 'text/vtt' }), name);
    setNotice(`Saved ${name}`);
  };

  const subtitleActions: SubtitleActions = {
    job: subtitleJob,
    time,
    selectedCueId,
    onSelectCue: selectCue,
    onGenerate: generateSubtitles,
    onCancel: () => subtitleAbortRef.current?.abort(),
    onCueChange: (cue) => setCues((cues) => sortCues(cues.map((c) => (c.id === cue.id ? cue : c)))),
    onCueDelete: deleteCue,
    onCueAdd: addCue,
    onCueSplit: (id) => setCues((cues) => splitCue(cues, id, time)),
    onCueMerge: (id) => setCues((cues) => mergeWithNext(cues, id)),
    onShift: (delta) => setCues((cues) => shiftCues(cues, delta, duration)),
    onImport: importSubtitles,
    onDownload: downloadSubtitles,
    onClear: () => {
      if (!window.confirm('Delete all subtitles?')) return;
      setCues(() => []);
      setSelectedCueId(null);
    },
    onSeek: seek,
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
        else if (selectedCueId && !subtitleJob) deleteCue(selectedCueId);
      } else if (e.key === 'z' || e.key === 'Z') {
        addZoom();
      } else if (e.key === 'Escape') {
        setSelection(null);
        setSelectedZoomId(null);
        setSelectedCueId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, selectedZoomId, selectedCueId, subtitleJob, cutSelection, deleteZoom, deleteCue, addZoom]);

  const outDuration = outputDuration(duration, project.cuts);

  return (
    <div className="flex h-screen flex-col bg-deep text-paper">
      {/* Header */}
      <header className="flex h-12 flex-shrink-0 items-center gap-3 border-b border-line bg-ink px-4">
        <div className="h-6 w-6 flex-shrink-0 rounded-full bg-accent-br shadow-orb" />
        <h1 className="text-[12px] font-bold tracking-wide">Qamrec</h1>
        <span className="text-line" aria-hidden>
          —
        </span>
        <span className="truncate text-[12px] text-paper/80">
          {project.title || 'Untitled recording'} • {formatDuration(outDuration)}
          {outDuration < duration && <span className="text-fog/60"> of {formatDuration(duration)}</span>} •{' '}
          {project.sourceWidth}×{project.sourceHeight}
        </span>
        <span className="hidden flex-shrink-0 items-center gap-1 rounded-full border border-line bg-card px-2 py-0.5 font-mono text-[10px] text-fog md:flex">
          <ShieldCheck className="h-3 w-3" /> LOCAL
        </span>
        {notice && (
          <span role="status" className="ml-2 truncate font-mono text-[11px] text-fog">
            {notice}
          </span>
        )}
        <div className="ml-auto flex flex-shrink-0 items-center gap-2">
          <button className="btn-pill" onClick={() => window.close()}>
            <X className="h-3.5 w-3.5" /> Close
          </button>
          <button className="btn-rec" onClick={doExport} disabled={exportProgress !== null}>
            <Upload className="h-3.5 w-3.5" />
            Export {settings.export.format.toUpperCase()}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col bg-ink">
          {/* Stage */}
          <div className="flex min-h-0 flex-1 flex-col px-4 pt-4 lg:px-6 lg:pt-5">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-[#1A1028] via-[#241A2E] to-[#1E1A14] p-3">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet/15 via-transparent to-ember/15" />
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
            <div className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-2 py-1.5 backdrop-blur">
                <button
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black hover:bg-paper"
                  onClick={() => playerRef.current?.toggle()}
                  title="Play/Pause (Space)"
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  {playing ? <Pause className="h-3.5 w-3.5 fill-black" /> : <Play className="ml-[1px] h-3.5 w-3.5 fill-black" />}
                </button>
                <span className="px-1 font-mono text-[11px] text-white/70">
                  {formatDuration(sourceToOutput(time, duration, project.cuts))} / {formatDuration(outDuration)}
                </span>
                <span className="mx-0.5 h-4 w-px bg-white/15" />
                <button
                  className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent"
                  disabled={!selection}
                  onClick={cutSelection}
                  title="Cut the selected range (Delete)"
                >
                  <Scissors className="h-3.5 w-3.5" /> Cut
                </button>
                <button
                  className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] text-white/70 hover:bg-white/10 hover:text-white"
                  onClick={addZoom}
                  title="Add a zoom keyframe at the playhead (Z)"
                >
                  <ZoomIn className="h-3.5 w-3.5" /> Add zoom
                </button>
              </div>
              <span className="hidden truncate font-mono text-[10px] text-fog/50 xl:block">
                Drag the clip to select • yellow handles trim • drag blocks to retime
              </span>
            </div>
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
            onSelectZoom={(id) => {
              setSelectedZoomId(id);
              if (id) setSelectedCueId(null);
            }}
            onChangeZoom={changeZoom}
            onRestoreZoom={(id) =>
              setProject((p) => ({ ...p, suppressedZoomIds: p.suppressedZoomIds.filter((s) => s !== id) }))
            }
            onTrim={(start, end) => setProject((p) => ({ ...p, cuts: setTrim(p.cuts, p.duration, start, end) }))}
            onRestoreCut={(t) => setProject((p) => ({ ...p, cuts: removeCutAt(p.cuts, t) }))}
            selectedCueId={selectedCueId}
            onSelectCue={selectCue}
            // Each transcribed chunk replaces the whole list, so edits made meanwhile would be lost
            onChangeCue={subtitleJob ? () => {} : subtitleActions.onCueChange}
          />
        </div>

        <aside className="w-[320px] flex-shrink-0 border-l border-line bg-ink">
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
            subtitles={subtitleActions}
          />
        </aside>
      </div>

      {/* Export progress */}
      {exportProgress !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div role="dialog" aria-label="Exporting" className="w-80 rounded-2xl border border-line bg-card p-5 shadow-panel">
            <div className="mb-3 flex items-center justify-between">
              <span className="label-mono">Rendering {settings.export.format.toUpperCase()}</span>
              <span className="font-mono text-[11px] text-paper">{Math.round(exportProgress * 100)}%</span>
            </div>
            <div className="mb-4 h-1 w-full overflow-hidden rounded-full bg-line">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${exportProgress * 100}%` }} />
            </div>
            <button className="btn-pill w-full justify-center" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
