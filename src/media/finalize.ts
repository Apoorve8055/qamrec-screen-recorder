import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Output, WebMOutputFormat } from 'mediabunny';

export interface MediaInfo {
  blob: Blob;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

/**
 * MediaRecorder WebM files have no duration or seek index, so they can't be scrubbed.
 * Remuxing (no re-encode) into a proper WebM fixes both.
 */
export async function finalizeRecording(raw: Blob): Promise<MediaInfo> {
  let blob = raw;
  try {
    const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input: new Input({ source: new BlobSource(raw), formats: ALL_FORMATS }),
      output,
    });
    if (conversion.isValid) {
      await conversion.execute();
      const buffer = output.target.buffer;
      if (buffer) blob = new Blob([buffer], { type: 'video/webm' });
    }
  } catch (err) {
    console.warn('Remux failed, using raw recording:', err);
  }
  return { ...(await probe(blob)), blob };
}

export async function probe(blob: Blob): Promise<Omit<MediaInfo, 'blob'>> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  const durationMs = (await input.computeDuration()) * 1000;
  return {
    durationMs,
    width: video ? await video.getDisplayWidth() : 0,
    height: video ? await video.getDisplayHeight() : 0,
    hasAudio: !!audio,
  };
}
