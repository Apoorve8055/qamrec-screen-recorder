import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  TextSubtitleSource,
  VideoSampleSink,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type VideoSample,
} from 'mediabunny';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { ExportFormat, ExportResolution } from '../shared/types';
import type { Scene } from '../effects/scene';
import { renderFrame, type FrameSources } from '../effects/compositor';
import { getBackgroundBlur, type BackgroundBlur } from '../effects/webcamBlur';
import { keptSegments, outputDuration, outputToSource, sourceToOutput } from '../editor/timeline';
import { outputSize } from '../shared/resolution';
import { outputCues, toVtt } from '../subtitles/subtitles';

export interface ExportOptions {
  scene: Scene;
  mainBlob: Blob;
  webcamBlob: Blob | null;
  format: ExportFormat;
  resolution: ExportResolution;
  fps: number;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

const GIF_MAX_FPS = 15;
const GIF_MAX_HEIGHT = 720;

const abortError = () => new DOMException('Export canceled', 'AbortError');

export function exportDimensions(scene: Scene, format: ExportFormat, resolution: ExportResolution) {
  const { sourceWidth, sourceHeight } = scene.project;
  const res = format === 'gif' && (resolution === 'original' || resolution > GIF_MAX_HEIGHT) ? GIF_MAX_HEIGHT : resolution;
  return outputSize(sourceWidth, sourceHeight, res);
}

export async function exportRecording(opts: ExportOptions): Promise<Blob> {
  return opts.format === 'gif' ? exportGif(opts) : exportVideo(opts);
}

/**
 * Yields composited frames in output order, drawing each into `canvas`.
 * Cuts are skipped by mapping every output instant back to source time.
 */
async function* renderFrames(opts: ExportOptions, canvas: OffscreenCanvas, fps: number) {
  const { scene } = opts;
  const { project } = scene;
  const ctx = canvas.getContext('2d', { willReadFrequently: opts.format === 'gif' })!;

  const mainTrack = await new Input({ source: new BlobSource(opts.mainBlob), formats: ALL_FORMATS }).getPrimaryVideoTrack();
  if (!mainTrack) throw new Error('The recording has no video track');

  const useWebcam = !!opts.webcamBlob && project.webcamOffsetMs !== null && project.settings.webcam.visible;
  const webcamTrack = useWebcam
    ? await new Input({ source: new BlobSource(opts.webcamBlob!), formats: ALL_FORMATS }).getPrimaryVideoTrack()
    : null;

  let blur: BackgroundBlur | null = null;
  if (project.settings.webcam.backgroundBlur && (webcamTrack || project.cameraOnly)) {
    blur = await getBackgroundBlur();
  }

  const total = Math.max(1, Math.floor((outputDuration(project.duration, project.cuts) / 1000) * fps));
  const sourceTimes = Array.from({ length: total }, (_, i) =>
    outputToSource((i * 1000) / fps, project.duration, project.cuts)
  );

  const mainSamples = new VideoSampleSink(mainTrack).samplesAtTimestamps(sourceTimes.map((t) => t / 1000));
  const webcamSamples = webcamTrack
    ? new VideoSampleSink(webcamTrack).samplesAtTimestamps(
        sourceTimes.map((t) => Math.max(0, t - (project.webcamOffsetMs ?? 0)) / 1000)
      )
    : null;

  let main: VideoSample | null = null;
  let webcam: VideoSample | null = null;
  const blurPx = project.settings.webcam.blurAmount;

  try {
    for (let i = 0; i < total; i++) {
      if (opts.signal.aborted) throw abortError();

      const nextMain = (await mainSamples.next()).value;
      if (nextMain) {
        main?.close();
        main = nextMain;
      }
      if (webcamSamples) {
        const nextWebcam = (await webcamSamples.next()).value;
        if (nextWebcam) {
          webcam?.close();
          webcam = nextWebcam;
        }
      }

      let screenSource: CanvasImageSource | null = main ? main.toCanvasImageSource() : null;
      let webcamSource: CanvasImageSource | null = webcam ? webcam.toCanvasImageSource() : null;
      if (blur && project.cameraOnly && main && screenSource) {
        screenSource = blur.process(screenSource, main.displayWidth, main.displayHeight, blurPx);
      } else if (blur && webcam && webcamSource) {
        webcamSource = blur.process(webcamSource, webcam.displayWidth, webcam.displayHeight, blurPx);
      }

      const sources: FrameSources = {
        screen: screenSource,
        screenWidth: main?.displayWidth ?? project.sourceWidth,
        screenHeight: main?.displayHeight ?? project.sourceHeight,
        webcam: webcamSource,
        webcamWidth: webcam?.displayWidth ?? 1,
        webcamHeight: webcam?.displayHeight ?? 1,
      };
      renderFrame(ctx, canvas.width, canvas.height, sources, scene, sourceTimes[i]);
      yield { index: i, total, timestamp: i / fps, ctx };
    }
  } finally {
    main?.close();
    webcam?.close();
    await mainSamples.return(undefined);
    await webcamSamples?.return(undefined);
  }
}

async function exportVideo(opts: ExportOptions): Promise<Blob> {
  const { scene, format, fps } = opts;
  const { project } = scene;
  const isMp4 = format === 'mp4';
  const { width, height } = exportDimensions(scene, format, opts.resolution);

  const videoCodec = await getFirstEncodableVideoCodec(isMp4 ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'], {
    width,
    height,
  });
  if (!videoCodec) throw new Error(`This browser can't encode ${format.toUpperCase()} video at ${width}×${height}`);

  const output = new Output({
    format: isMp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const canvas = new OffscreenCanvas(width, height);
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource);

  const audioInput = new Input({ source: new BlobSource(opts.mainBlob), formats: ALL_FORMATS });
  const audioTrack = await audioInput.getPrimaryAudioTrack();
  let audioSource: AudioSampleSource | null = null;
  if (audioTrack && (await audioTrack.canDecode())) {
    const audioCodec = await getFirstEncodableAudioCodec(isMp4 ? ['aac', 'opus'] : ['opus', 'vorbis']);
    if (audioCodec) {
      audioSource = new AudioSampleSource({ codec: audioCodec, bitrate: QUALITY_HIGH });
      output.addAudioTrack(audioSource);
    }
  }

  // Optional soft subtitles: a toggleable WebVTT track, alongside any burned-in captions
  const subs = project.settings.subtitles;
  const vtt =
    subs.embedTrack && outputCues(project.subtitles, project.duration, project.cuts).length
      ? toVtt(project.subtitles, project.duration, project.cuts, subs.maxChars)
      : null;
  let subtitleSource: TextSubtitleSource | null = null;
  if (vtt && output.format.getSupportedSubtitleCodecs().includes('webvtt')) {
    subtitleSource = new TextSubtitleSource('webvtt');
    output.addSubtitleTrack(subtitleSource, { name: 'Subtitles', disposition: { default: false } });
  }

  await output.start();

  const subtitleLoop = async () => {
    if (!subtitleSource || !vtt) return;
    await subtitleSource.add(vtt);
    subtitleSource.close();
  };

  const videoLoop = async () => {
    for await (const frame of renderFrames(opts, canvas, fps)) {
      await videoSource.add(frame.timestamp, 1 / fps);
      opts.onProgress((frame.index + 1) / frame.total);
    }
    videoSource.close();
  };

  const audioLoop = async () => {
    if (!audioSource || !audioTrack) return;
    const sink = new AudioBufferSink(audioTrack);
    for (const seg of keptSegments(project.duration, project.cuts)) {
      const segStart = seg.start / 1000;
      const segEnd = seg.end / 1000;
      const outStart = sourceToOutput(seg.start, project.duration, project.cuts) / 1000;
      for await (const { buffer, timestamp } of sink.buffers(segStart, segEnd)) {
        if (opts.signal.aborted) throw abortError();
        const from = Math.max(segStart, timestamp);
        const to = Math.min(segEnd, timestamp + buffer.duration);
        const i0 = Math.round((from - timestamp) * buffer.sampleRate);
        const i1 = Math.min(buffer.length, Math.round((to - timestamp) * buffer.sampleRate));
        const frames = i1 - i0;
        if (frames <= 0) continue;

        const channels = buffer.numberOfChannels;
        const data = new Float32Array(frames * channels);
        for (let c = 0; c < channels; c++) data.set(buffer.getChannelData(c).subarray(i0, i1), c * frames);
        const sample = new AudioSample({
          data,
          format: 'f32-planar',
          numberOfChannels: channels,
          sampleRate: buffer.sampleRate,
          timestamp: outStart + (from - segStart),
        });
        await audioSource.add(sample);
        sample.close();
      }
    }
    audioSource.close();
  };

  try {
    await Promise.all([videoLoop(), audioLoop(), subtitleLoop()]);
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => {});
    throw err;
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Export produced no data');
  return new Blob([buffer], { type: isMp4 ? 'video/mp4' : 'video/webm' });
}

async function exportGif(opts: ExportOptions): Promise<Blob> {
  const fps = Math.min(GIF_MAX_FPS, opts.fps);
  const { width, height } = exportDimensions(opts.scene, 'gif', opts.resolution);
  const canvas = new OffscreenCanvas(width, height);
  const gif = GIFEncoder();
  const delay = Math.round(1000 / fps);

  for await (const frame of renderFrames(opts, canvas, fps)) {
    const { data } = frame.ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256, { format: 'rgb565' });
    const index = applyPalette(data, palette, 'rgb565');
    gif.writeFrame(index, width, height, { palette, delay });
    opts.onProgress((frame.index + 1) / frame.total);
    // Let the UI breathe
    if (frame.index % 5 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
}
