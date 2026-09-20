import type { Range, SubtitleCue, SubtitleModel } from '../shared/types';
import { keptSegments } from '../editor/timeline';
import { SpeechAudioReader } from './audio';
import { cleanWords, planChunks, wordsToCues, type TimedWord } from './subtitles';
import type { WhisperDevice, WorkerRequest, WorkerResponse } from './protocol';

/** Languages offered in the UI (Whisper understands ~100; these are the common ones) */
export const SUBTITLE_LANGUAGES: { code: string; label: string }[] = [
  { code: 'auto', label: 'Detect automatically' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'sv', label: 'Swedish' },
  { code: 'pl', label: 'Polish' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ru', label: 'Russian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ar', label: 'Arabic' },
  { code: 'he', label: 'Hebrew' },
  { code: 'fa', label: 'Persian' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'ur', label: 'Urdu' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'mr', label: 'Marathi' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
  { code: 'id', label: 'Indonesian' },
];

export type TranscribeStatus =
  | { stage: 'loading'; loaded: number; total: number }
  | { stage: 'transcribing'; fraction: number; device: WhisperDevice };

export interface TranscribeOptions {
  blob: Blob;
  durationMs: number;
  cuts: Range[];
  envelope: Float32Array;
  envelopeWindowMs: number;
  model: SubtitleModel;
  language: string;
  maxChars: number;
  onStatus: (status: TranscribeStatus) => void;
  /** Cues found so far, as each chunk finishes */
  onPartial: (cues: SubtitleCue[]) => void;
  signal: AbortSignal;
}

const CHUNK = { maxMs: 28_000, searchMs: 10_000, silenceDb: -50 };

const abortError = () => new DOMException('Canceled', 'AbortError');

/** One worker, kept alive between runs so the model stays loaded; terminated on cancel */
let worker: Worker | null = null;
let requestId = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

function killWorker() {
  worker?.terminate();
  worker = null;
}

/** Sends a request and resolves with the matching response; `onMessage` sees every other message */
function call(
  w: Worker,
  request: WorkerRequest,
  done: (msg: WorkerResponse) => boolean,
  signal: AbortSignal,
  onMessage?: (msg: WorkerResponse) => void
): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      w.removeEventListener('message', listen);
      w.removeEventListener('error', fail);
      signal.removeEventListener('abort', abort);
    };
    const listen = (e: MessageEvent<WorkerResponse>) => {
      if (done(e.data)) {
        cleanup();
        if (e.data.type === 'error') reject(new Error(e.data.message));
        else resolve(e.data);
      } else {
        onMessage?.(e.data);
      }
    };
    const fail = (e: ErrorEvent) => {
      cleanup();
      killWorker();
      reject(new Error(e.message || 'The speech recognition worker crashed'));
    };
    const abort = () => {
      cleanup();
      // Inference can't be interrupted, so the worker goes; the model is cached for next time
      killWorker();
      reject(abortError());
    };
    if (signal.aborted) return abort();
    w.addEventListener('message', listen);
    w.addEventListener('error', fail);
    signal.addEventListener('abort', abort);
    w.postMessage(request);
  });
}

/**
 * Generates subtitles from the recording's audio, on this device.
 * Silent stretches and parts that were cut away are skipped.
 */
export async function transcribe(opts: TranscribeOptions): Promise<SubtitleCue[]> {
  const { signal } = opts;
  const reader = await SpeechAudioReader.open(opts.blob);
  if (!reader.hasAudio) throw new Error('This recording has no audio to transcribe.');

  const kept = keptSegments(opts.durationMs, opts.cuts);
  const chunks = planChunks(opts.envelope, opts.envelopeWindowMs, opts.durationMs, CHUNK).filter((c) =>
    kept.some((k) => k.start < c.end && k.end > c.start)
  );
  if (!chunks.length) return [];

  const w = getWorker();
  opts.onStatus({ stage: 'loading', loaded: 0, total: 0 });
  const ready = await call(
    w,
    { type: 'load', model: opts.model },
    (m) => m.type === 'ready' || (m.type === 'error' && m.id === null),
    signal,
    (m) => {
      if (m.type === 'download') opts.onStatus({ stage: 'loading', loaded: m.loaded, total: m.total });
    }
  );
  const device = ready.type === 'ready' ? ready.device : 'wasm';

  const total = chunks.reduce((s, c) => s + c.end - c.start, 0);
  const words: TimedWord[] = [];
  const cueOptions = { maxChars: opts.maxChars };
  let done = 0;
  opts.onStatus({ stage: 'transcribing', fraction: 0, device });

  for (const chunk of chunks) {
    if (signal.aborted) throw abortError();
    const audio = await reader.read(chunk);
    const id = ++requestId;
    const res = await call(
      w,
      { type: 'transcribe', id, audio, language: opts.language === 'auto' ? null : opts.language },
      (m) => (m.type === 'result' || m.type === 'error') && m.id === id,
      signal
    );
    if (res.type === 'result') {
      for (const word of res.words) {
        const start = Math.min(word.start + chunk.start, chunk.end);
        words.push({ text: word.text, start, end: Math.min(word.end + chunk.start, chunk.end) });
      }
    }
    done += chunk.end - chunk.start;
    opts.onStatus({ stage: 'transcribing', fraction: done / total, device });
    opts.onPartial(wordsToCues(cleanWords(words), cueOptions));
  }

  return wordsToCues(cleanWords(words), cueOptions).map((c) => ({ ...c, end: Math.min(c.end, opts.durationMs) }));
}
