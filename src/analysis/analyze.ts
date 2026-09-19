import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { ActivitySample } from '../effects/zoom';
import { changeBox, detectSceneCuts, frameDiff, toGray } from './scenes';

export interface AnalysisResult {
  activity: ActivitySample[];
  sceneCuts: number[];
  /** RMS level per window (for waveform, silence removal) */
  envelope: Float32Array;
  envelopeWindowMs: number;
}

const THUMB_W = 64;
const THUMB_H = 36;
const ENVELOPE_WINDOW_MS = 50;

/**
 * Offline analysis of a finished recording: on-screen activity (smart auto-framing,
 * highlights), scene cuts (chapters) and the audio envelope (waveform, silence removal).
 */
export async function analyzeRecording(
  blob: Blob,
  durationMs: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<AnalysisResult> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const activity: ActivitySample[] = [];
  const diffs: { t: number; diff: number }[] = [];

  const video = await input.getPrimaryVideoTrack();
  if (video && (await video.canDecode())) {
    const stepMs = durationMs > 10 * 60_000 ? 500 : 250;
    const sink = new CanvasSink(video, { width: THUMB_W, height: THUMB_H, fit: 'fill', poolSize: 1 });
    const times: number[] = [];
    for (let t = 0; t < durationMs; t += stepMs) times.push(t);

    let prev: Uint8Array | null = null;
    let i = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(times.map((t) => t / 1000))) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const t = times[i++];
      if (!wrapped) continue;
      const ctx = wrapped.canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      const gray = toGray(ctx.getImageData(0, 0, THUMB_W, THUMB_H).data, THUMB_W, THUMB_H);
      if (prev) {
        diffs.push({ t, diff: frameDiff(prev, gray) });
        const { bbox, amount } = changeBox(prev, gray, THUMB_W, THUMB_H);
        activity.push({ t, bbox, amount });
      }
      prev = gray;
      if (i % 20 === 0) onProgress?.(0.7 * (i / times.length));
    }
  }

  const envelope = await audioEnvelope(input, durationMs, (f) => onProgress?.(0.7 + 0.3 * f), signal);
  onProgress?.(1);

  return {
    activity,
    sceneCuts: detectSceneCuts(diffs, { minDiff: 0.12, minGapMs: 3000 }),
    envelope,
    envelopeWindowMs: ENVELOPE_WINDOW_MS,
  };
}

async function audioEnvelope(
  input: Input,
  durationMs: number,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<Float32Array> {
  const windows = Math.ceil(durationMs / ENVELOPE_WINDOW_MS) + 1;
  const sums = new Float64Array(windows);
  const counts = new Uint32Array(windows);

  const audio = await input.getPrimaryAudioTrack();
  if (audio && (await audio.canDecode())) {
    const sink = new AudioBufferSink(audio);
    for await (const { buffer, timestamp } of sink.buffers()) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
      const rate = buffer.sampleRate;
      for (let i = 0; i < buffer.length; i++) {
        const idx = Math.floor(((timestamp + i / rate) * 1000) / ENVELOPE_WINDOW_MS);
        if (idx < 0 || idx >= windows) continue;
        let sq = 0;
        for (const ch of channels) sq += ch[i] * ch[i];
        sums[idx] += sq / channels.length;
        counts[idx]++;
      }
      onProgress(Math.min(1, (timestamp * 1000) / durationMs));
    }
  }

  const envelope = new Float32Array(windows);
  for (let i = 0; i < windows; i++) envelope[i] = counts[i] ? Math.sqrt(sums[i] / counts[i]) : 0;
  return envelope;
}
