import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import type { Range } from '../shared/types';

/** Whisper expects 16 kHz mono */
export const SPEECH_SAMPLE_RATE = 16_000;

/**
 * Adds decoded audio into a mono output at `targetRate`: every source sample is averaged
 * into the output sample it falls in (a box filter, plenty for speech).
 */
export function accumulateMono(
  sums: Float32Array,
  counts: Uint8Array,
  channels: Float32Array[],
  sampleRate: number,
  timestampSec: number,
  targetRate: number
): void {
  if (!channels.length) return;
  const base = timestampSec * targetRate;
  const step = targetRate / sampleRate;
  const length = channels[0].length;
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(base + i * step + 1e-6);
    if (idx < 0 || idx >= sums.length || counts[idx] === 255) continue;
    let s = 0;
    for (const ch of channels) s += ch[i];
    sums[idx] += s / channels.length;
    counts[idx]++;
  }
}

/** Turns the sums into averages, in place */
export function finishMono(sums: Float32Array, counts: Uint8Array): Float32Array {
  for (let i = 0; i < sums.length; i++) sums[i] = counts[i] ? sums[i] / counts[i] : 0;
  return sums;
}

/** Reads 16 kHz mono speech audio from a recording, one range at a time */
export class SpeechAudioReader {
  private constructor(private sink: AudioBufferSink | null) {}

  static async open(blob: Blob): Promise<SpeechAudioReader> {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    return new SpeechAudioReader(track && (await track.canDecode()) ? new AudioBufferSink(track) : null);
  }

  get hasAudio(): boolean {
    return this.sink !== null;
  }

  async read(range: Range): Promise<Float32Array> {
    const startSec = range.start / 1000;
    const endSec = range.end / 1000;
    const length = Math.max(1, Math.ceil((endSec - startSec) * SPEECH_SAMPLE_RATE));
    const sums = new Float32Array(length);
    const counts = new Uint8Array(length);
    if (this.sink) {
      for await (const { buffer, timestamp } of this.sink.buffers(startSec, endSec)) {
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
        accumulateMono(sums, counts, channels, buffer.sampleRate, timestamp - startSec, SPEECH_SAMPLE_RATE);
      }
    }
    return finishMono(sums, counts);
  }
}
