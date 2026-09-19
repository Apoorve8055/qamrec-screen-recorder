export type AudioSourceLabel = 'system' | 'mic';

/**
 * Mixes system audio and microphone into a single track (MediaRecorder only records
 * one audio track), with per-source level meters and optional mic cleanup.
 */
export class AudioMixer {
  private readonly ctx = new AudioContext();
  private readonly destination = this.ctx.createMediaStreamDestination();
  private readonly meters = new Map<AudioSourceLabel, AnalyserNode>();
  private readonly buffer = new Float32Array(1024);

  addSource(
    label: AudioSourceLabel,
    stream: MediaStream,
    opts: { monitor?: boolean; noiseReduction?: boolean } = {}
  ): void {
    if (!stream.getAudioTracks().length) return;
    let node: AudioNode = this.ctx.createMediaStreamSource(stream);

    if (opts.noiseReduction) {
      // Browser noise suppression runs on the track itself; this removes low rumble and evens out levels
      const highpass = this.ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 90;
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -28;
      compressor.ratio.value = 3;
      node.connect(highpass);
      highpass.connect(compressor);
      node = compressor;
    }

    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    node.connect(analyser);
    node.connect(this.destination);
    // Tab capture mutes the tab for the user; play it back so they can still hear it
    if (opts.monitor) node.connect(this.ctx.destination);
    this.meters.set(label, analyser);
  }

  get hasSources(): boolean {
    return this.meters.size > 0;
  }

  get track(): MediaStreamTrack | null {
    return this.hasSources ? this.destination.stream.getAudioTracks()[0] ?? null : null;
  }

  /** Current level of a source, 0..1 (null if the source isn't present) */
  level(label: AudioSourceLabel): number | null {
    const analyser = this.meters.get(label);
    if (!analyser) return null;
    analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (const v of this.buffer) sum += v * v;
    const rms = Math.sqrt(sum / this.buffer.length);
    // Map roughly -60..0 dBFS to 0..1
    const db = 20 * Math.log10(rms + 1e-8);
    return Math.max(0, Math.min(1, (db + 60) / 60));
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  close(): void {
    this.ctx.close().catch(() => {});
  }
}
