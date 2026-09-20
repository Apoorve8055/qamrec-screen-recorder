/// <reference lib="webworker" />
/// <reference types="vite/client" />
// The extension CSP only runs scripts shipped with the extension, so the ONNX Runtime files are
// bundled as assets instead of being fetched from a CDN
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionOutput,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
import { WHISPER_MODELS, type WhisperDevice, type WorkerRequest, type WorkerResponse } from './protocol';
import type { SubtitleModel } from '../shared/types';

/**
 * Speech-to-text with Whisper, entirely on this device (WebGPU when available, otherwise WASM).
 * Only the open model weights are downloaded (once, then cached); audio never leaves the worker.
 */

declare const self: DedicatedWorkerGlobalScope;

interface Loaded {
  pipe: AutomaticSpeechRecognitionPipeline;
  device: WhisperDevice;
}

let loaded: Promise<Loaded> | null = null;
let loadedModel: SubtitleModel | null = null;

const post = (msg: WorkerResponse) => self.postMessage(msg);

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function load(model: SubtitleModel): Promise<Loaded> {
  env.allowLocalModels = false;
  // Use the bundled runtime as-is (the wasm cache would re-load it from a blob: URL, which the CSP blocks)
  env.useWasmCache = false;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = {
      mjs: new URL(ortMjsUrl, self.location.href).href,
      wasm: new URL(ortWasmUrl, self.location.href).href,
    };
  }

  const id = WHISPER_MODELS[model];
  const progress_callback = (p: ProgressInfo) => {
    if (p.status === 'progress_total') post({ type: 'download', loaded: p.loaded, total: p.total });
  };

  if (await hasWebGpu()) {
    try {
      const pipe = await pipeline('automatic-speech-recognition', id, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback,
      });
      return { pipe, device: 'webgpu' };
    } catch (err) {
      console.warn('Whisper on WebGPU failed, falling back to WASM:', err);
    }
  }
  const pipe = await pipeline('automatic-speech-recognition', id, { device: 'wasm', dtype: 'q8', progress_callback });
  return { pipe, device: 'wasm' };
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'load') {
    if (!loaded || loadedModel !== msg.model) {
      // Free the previous model (GPU memory on WebGPU) before loading another
      loaded
        ?.then(({ pipe }) => pipe.dispose())
        .catch(() => {});
      loadedModel = msg.model;
      loaded = load(msg.model);
    }
    try {
      post({ type: 'ready', device: (await loaded).device });
    } catch (err) {
      loaded = null;
      loadedModel = null;
      post({ type: 'error', id: null, message: (err as Error).message || String(err) });
    }
    return;
  }

  try {
    if (!loaded) throw new Error('Speech model not loaded');
    const { pipe } = await loaded;
    const out = (await pipe(msg.audio, {
      return_timestamps: 'word',
      task: 'transcribe',
      ...(msg.language ? { language: msg.language } : {}),
    })) as AutomaticSpeechRecognitionOutput;
    const words = (out.chunks ?? []).map((c) => ({
      text: c.text,
      start: c.timestamp[0] * 1000,
      end: c.timestamp[1] === null ? NaN : c.timestamp[1] * 1000,
    }));
    post({ type: 'result', id: msg.id, words });
  } catch (err) {
    post({ type: 'error', id: msg.id, message: (err as Error).message || String(err) });
  }
};
