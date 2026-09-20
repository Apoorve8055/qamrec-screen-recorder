import type { SubtitleModel } from '../shared/types';
import type { TimedWord } from './subtitles';

/** Messages between the editor and the speech-to-text worker */

export type WhisperDevice = 'webgpu' | 'wasm';

export type WorkerRequest =
  | { type: 'load'; model: SubtitleModel }
  /** Mono 16 kHz audio; `language` is a Whisper language code or null to detect */
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string | null };

export type WorkerResponse =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'ready'; device: WhisperDevice }
  /** Word times in ms, relative to the start of the audio sent */
  | { type: 'result'; id: number; words: TimedWord[] }
  | { type: 'error'; id: number | null; message: string };

/** Open Whisper models (Apache-2.0) converted for the browser with word-level timestamps */
export const WHISPER_MODELS: Record<SubtitleModel, string> = {
  tiny: 'onnx-community/whisper-tiny_timestamped',
  base: 'onnx-community/whisper-base_timestamped',
  small: 'onnx-community/whisper-small_timestamped',
};
