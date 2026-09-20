import { useEffect, useRef, useState } from 'react';
import type { Range, SubtitleCue, ZoomRegion } from '../shared/types';
import type { Scene } from '../effects/scene';
import { formatDuration } from '../utils/format';
import { getTrim, normalizeRanges } from './timeline';

interface Props {
  scene: Scene;
  time: number;
  envelope: Float32Array;
  envelopeWindowMs: number;
  selection: Range | null;
  selectedZoomId: string | null;
  onSeek: (t: number) => void;
  onSelection: (r: Range | null) => void;
  onSelectZoom: (id: string | null) => void;
  onChangeZoom: (r: ZoomRegion) => void;
  onRestoreZoom: (id: string) => void;
  onTrim: (start: number, end: number) => void;
  onRestoreCut: (t: number) => void;
  selectedCueId: string | null;
  onSelectCue: (id: string | null) => void;
  onChangeCue: (cue: SubtitleCue) => void;
}

const TICK_STEPS = [1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
const MIN_ZOOM_MS = 300;
const MIN_CUE_MS = 200;
const DRAG_THRESHOLD_PX = 3;

export function TimelineView({
  scene,
  time,
  envelope,
  envelopeWindowMs,
  selection,
  selectedZoomId,
  onSeek,
  onSelection,
  onSelectZoom,
  onChangeZoom,
  onRestoreZoom,
  onTrim,
  onRestoreCut,
  selectedCueId,
  onSelectCue,
  onChangeCue,
}: Props) {
  const { project } = scene;
  const duration = Math.max(1, project.duration);
  const lanesRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Waveform
  useEffect(() => {
    const canvas = waveRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.round(40 * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let peak = 1e-6;
    for (const v of envelope) peak = Math.max(peak, v);
    ctx.fillStyle = 'rgba(245, 245, 240, 0.35)';
    const perPx = duration / envelopeWindowMs / canvas.width;
    for (let x = 0; x < canvas.width; x++) {
      const from = Math.floor(x * perPx);
      const to = Math.max(from + 1, Math.floor((x + 1) * perPx));
      let m = 0;
      for (let i = from; i < to && i < envelope.length; i++) m = Math.max(m, envelope[i]);
      const h = Math.sqrt(m / peak) * canvas.height * 0.9;
      ctx.fillRect(x, (canvas.height - h) / 2, 1, Math.max(1, h));
    }
  }, [envelope, envelopeWindowMs, duration, width]);

  const pct = (t: number) => `${(t / duration) * 100}%`;
  const timeAt = (clientX: number) => {
    const rect = lanesRef.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration));
  };

  /** Pointer-captured drag; reports time under the pointer and delta from the start */
  const drag = (
    e: React.PointerEvent,
    onMove: (t: number, delta: number) => void,
    onEnd?: (moved: boolean, t: number) => void
  ) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const t0 = timeAt(e.clientX);
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > DRAG_THRESHOLD_PX) moved = true;
      if (moved) onMove(timeAt(ev.clientX), timeAt(ev.clientX) - t0);
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      onEnd?.(moved, timeAt(ev.clientX));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const step = TICK_STEPS.find((s) => duration / s <= 12) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += step) ticks.push(t);

  const trim = getTrim(project.cuts, duration);
  const innerCuts = normalizeRanges(project.cuts, duration).filter((c) => c.start !== 0 && c.end !== duration);
  const suppressed = new Set(project.suppressedZoomIds);
  const dimmedZooms = scene.autoZooms.filter((r) => suppressed.has(r.id));

  return (
    <div className="select-none border-t border-line bg-ink px-4 pb-3 pt-2 font-mono text-[10px] text-fog/50">
      <div ref={lanesRef} className="relative">
        {/* Ruler: ticks, highlights, chapters */}
        <div
          className="relative h-7 cursor-pointer border-b border-line-faint"
          onPointerDown={(e) =>
            drag(
              e,
              (t) => onSeek(t),
              (_, t) => onSeek(t)
            )
          }
        >
          {ticks.map((t) => (
            <div key={t} className="absolute top-0 h-full border-l border-line-faint pl-1" style={{ left: pct(t) }}>
              {formatDuration(t)}
            </div>
          ))}
          {project.highlights.map((h) => (
            <div
              key={`h-${h.start}`}
              title="Highlight"
              className="absolute bottom-0 h-1 rounded-full bg-mark/80"
              style={{ left: pct(h.start), width: pct(h.end - h.start) }}
            />
          ))}
          {project.chapters.map((c, i) => (
            <button
              key={`c-${c.t}`}
              title={c.title}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onSeek(c.t)}
              className="absolute top-3 -ml-1.5 h-3 w-3 rotate-45 rounded-[2px] bg-white hover:bg-paper"
              style={{ left: pct(c.t) }}
              aria-label={`Chapter ${i + 1}: ${c.title}`}
            />
          ))}
        </div>

        {/* Clip lane: trim, cuts, selection */}
        <div
          className="relative mt-2 h-10 cursor-text overflow-hidden rounded-md border border-line-faint bg-paper/10 bg-[repeating-linear-gradient(90deg,transparent_0_6px,rgba(255,255,255,0.07)_6px_7px)]"
          title="Drag to select a range to cut; click to seek"
          onPointerDown={(e) => {
            const t0 = timeAt(e.clientX);
            drag(
              e,
              (t) => onSelection({ start: Math.min(t0, t), end: Math.max(t0, t) }),
              (moved, t) => {
                if (!moved) {
                  onSelection(null);
                  onSeek(t);
                }
              }
            );
          }}
        >
          {trim.start > 0 && <div className="absolute inset-y-0 left-0 bg-black/70" style={{ width: pct(trim.start) }} />}
          {trim.end < duration && (
            <div className="absolute inset-y-0 right-0 bg-black/70" style={{ width: pct(duration - trim.end) }} />
          )}
          {innerCuts.map((c) => (
            <button
              key={`cut-${c.start}`}
              title="Cut — click to restore"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onRestoreCut((c.start + c.end) / 2)}
              className="absolute inset-y-0 bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.75)_0,rgba(0,0,0,0.75)_4px,rgba(255,59,48,0.35)_4px,rgba(255,59,48,0.35)_8px)]"
              style={{ left: pct(c.start), width: pct(c.end - c.start) }}
            />
          ))}
          {selection && (
            <div
              className="pointer-events-none absolute inset-y-0 border-x-2 border-white bg-white/25"
              style={{ left: pct(selection.start), width: pct(selection.end - selection.start) }}
            />
          )}
          {/* Trim handles */}
          <div
            title="Trim start"
            className="absolute inset-y-0 z-10 w-2 cursor-ew-resize rounded-l-md bg-mark"
            style={{ left: pct(trim.start) }}
            onPointerDown={(e) => drag(e, (t) => onTrim(Math.min(t, trim.end - 500), trim.end))}
          />
          <div
            title="Trim end"
            className="absolute inset-y-0 z-10 -ml-2 w-2 cursor-ew-resize rounded-r-md bg-mark"
            style={{ left: pct(trim.end) }}
            onPointerDown={(e) => drag(e, (t) => onTrim(trim.start, Math.max(t, trim.start + 500)))}
          />
        </div>

        {/* Waveform */}
        <canvas ref={waveRef} className="mt-1 h-10 w-full" />

        {/* Zoom lane */}
        <div className="relative mt-1 h-8 rounded-md border border-line-faint bg-well">
          {dimmedZooms.map((r) => (
            <button
              key={r.id}
              title="Deleted auto zoom — click to restore"
              onClick={() => onRestoreZoom(r.id)}
              className="absolute inset-y-1 rounded border border-dashed border-line-strong"
              style={{ left: pct(r.start), width: pct(r.end - r.start) }}
            />
          ))}
          {scene.regions.map((r) => (
            <div
              key={r.id}
              title={`${r.source === 'auto' ? 'Auto' : 'Manual'} zoom ×${r.scale.toFixed(1)}`}
              className={`absolute inset-y-1 flex cursor-grab items-center justify-center overflow-hidden rounded text-[10px] font-medium text-white ${
                r.source === 'auto' ? 'border border-violet/40 bg-gradient-to-r from-violet/50 to-ember/50' : 'border border-ember/40 bg-ember/40'
              } ${r.id === selectedZoomId ? 'ring-2 ring-white' : ''}`}
              style={{ left: pct(r.start), width: pct(r.end - r.start) }}
              onPointerDown={(e) => {
                onSelectZoom(r.id);
                const len = r.end - r.start;
                drag(e, (_, d) => {
                  const start = Math.min(duration - len, Math.max(0, r.start + d));
                  onChangeZoom({ ...r, start, end: start + len });
                });
              }}
            >
              ×{r.scale.toFixed(1)}
              <span
                className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/30"
                onPointerDown={(e) => drag(e, (t) => onChangeZoom({ ...r, start: Math.min(t, r.end - MIN_ZOOM_MS) }))}
              />
              <span
                className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/30"
                onPointerDown={(e) => drag(e, (t) => onChangeZoom({ ...r, end: Math.max(t, r.start + MIN_ZOOM_MS) }))}
              />
            </div>
          ))}
        </div>

        {/* Subtitle lane */}
        {project.subtitles.length > 0 && (
          <div className="relative mt-1 h-7 rounded-md border border-line-faint bg-well">
            {project.subtitles.map((c) => (
              <div
                key={c.id}
                title={c.text}
                className={`absolute inset-y-1 flex cursor-grab items-center overflow-hidden whitespace-nowrap rounded border border-paper/20 bg-paper/15 px-1.5 text-[10px] text-white ${
                  c.id === selectedCueId ? 'z-10 ring-2 ring-white' : ''
                }`}
                style={{ left: pct(c.start), width: pct(c.end - c.start) }}
                onPointerDown={(e) => {
                  onSelectCue(c.id);
                  const len = c.end - c.start;
                  drag(
                    e,
                    (_, d) => {
                      const start = Math.min(duration - len, Math.max(0, c.start + d));
                      onChangeCue({ ...c, start, end: start + len });
                    },
                    (moved) => {
                      if (!moved) onSeek(c.start);
                    }
                  );
                }}
              >
                {c.text}
                <span
                  className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/30"
                  onPointerDown={(e) => drag(e, (t) => onChangeCue({ ...c, start: Math.min(t, c.end - MIN_CUE_MS) }))}
                />
                <span
                  className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/30"
                  onPointerDown={(e) => drag(e, (t) => onChangeCue({ ...c, end: Math.max(t, c.start + MIN_CUE_MS) }))}
                />
              </div>
            ))}
          </div>
        )}

        {/* Playhead */}
        <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-rec" style={{ left: pct(time) }}>
          <div className="-ml-1 -mt-1 h-2 w-2 rotate-45 bg-rec" />
        </div>
      </div>
      <div className="mt-1 flex gap-4 text-[11px] text-gray-500">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-violet" />
          Auto zoom
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-ember" />
          Manual zoom
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rotate-45 bg-white" />
          Chapter
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-mark" />
          Highlight
        </span>
        {project.subtitles.length > 0 && (
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-paper/40" />
            Subtitle
          </span>
        )}
      </div>
    </div>
  );
}
