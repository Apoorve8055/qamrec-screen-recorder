import type { Range } from '../shared/types';

/** Mono RMS level per window, averaged across channels */
export function rmsEnvelope(channels: Float32Array[], sampleRate: number, windowMs: number): Float32Array {
  const win = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const length = channels.length ? channels[0].length : 0;
  const n = Math.floor(length / win);
  const env = new Float32Array(n);

  for (let w = 0; w < n; w++) {
    let sum = 0;
    for (const ch of channels) {
      for (let i = w * win; i < (w + 1) * win; i++) sum += ch[i] * ch[i];
    }
    env[w] = Math.sqrt(sum / (win * channels.length));
  }
  return env;
}

export interface SilenceOptions {
  /** Level below which audio counts as silent, dBFS */
  thresholdDb: number;
  /** Only silences at least this long are removed */
  minSilenceMs: number;
  /** Audio kept on each side of speech so cuts don't clip words */
  paddingMs: number;
}

/** Silent stretches worth cutting, in ms */
export function detectSilences(env: Float32Array, windowMs: number, opts: SilenceOptions): Range[] {
  const threshold = Math.pow(10, opts.thresholdDb / 20);
  const total = env.length * windowMs;
  const out: Range[] = [];

  let runStart = -1;
  const flush = (endIndex: number) => {
    if (runStart < 0) return;
    const start = runStart * windowMs;
    const end = endIndex * windowMs;
    if (end - start >= opts.minSilenceMs) {
      const padStart = start === 0 ? 0 : start + opts.paddingMs;
      const padEnd = end >= total ? total : end - opts.paddingMs;
      if (padEnd > padStart) out.push({ start: padStart, end: padEnd });
    }
    runStart = -1;
  };

  for (let i = 0; i < env.length; i++) {
    if (env[i] < threshold) {
      if (runStart < 0) runStart = i;
    } else {
      flush(i);
    }
  }
  flush(env.length);
  return out;
}
