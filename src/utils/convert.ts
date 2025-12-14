import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export type ConversionProgress = {
  phase: 'extracting' | 'encoding' | 'done';
  progress: number;
};

export type VideoResolution = 'original' | 1080 | 720 | 480;

/**
 * Convert a video blob to GIF using gifenc
 * Extracts frames from video and encodes them to GIF
 */
export async function convertToGif(
  videoBlob: Blob,
  onProgress?: (progress: ConversionProgress) => void,
  resolution: VideoResolution = 'original'
): Promise<Blob> {
  onProgress?.({ phase: 'extracting', progress: 0 });

  // Create video element to extract frames
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;

  // Load video
  const videoUrl = URL.createObjectURL(videoBlob);
  video.src = videoUrl;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Failed to load video'));
  });

  // Wait for video to be ready
  await new Promise<void>((resolve) => {
    video.oncanplaythrough = () => resolve();
    video.load();
  });

  const duration = video.duration;
  const fps = 15; // Smoother GIF frame rate
  const frameInterval = 1 / fps;
  const totalFrames = Math.floor(duration * fps); // No frame limit for full quality

  // Calculate dimensions based on resolution setting
  const maxWidth = resolution === 'original' ? Infinity : resolution;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.floor(video.videoWidth * scale);
  const height = Math.floor(video.videoHeight * scale);

  // Create canvas for frame extraction
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  // Initialize GIF encoder
  const gif = GIFEncoder();

  // Extract frames
  const frames: ImageData[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const time = i * frameInterval;
    video.currentTime = time;

    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    // Draw frame to canvas
    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    frames.push(imageData);

    onProgress?.({
      phase: 'extracting',
      progress: Math.round((i / totalFrames) * 50),
    });
  }

  // Cleanup video
  URL.revokeObjectURL(videoUrl);

  onProgress?.({ phase: 'encoding', progress: 50 });

  // Encode frames to GIF
  const delay = Math.round(1000 / fps); // Delay in ms

  for (let i = 0; i < frames.length; i++) {
    const imageData = frames[i];

    // Quantize to 256 colors
    const palette = quantize(imageData.data, 256);
    const index = applyPalette(imageData.data, palette);

    // Write frame
    gif.writeFrame(index, width, height, {
      palette,
      delay,
    });

    onProgress?.({
      phase: 'encoding',
      progress: 50 + Math.round((i / frames.length) * 50),
    });

    // Yield to browser every 10 frames to allow UI updates
    if (i % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  // Finish encoding
  gif.finish();

  onProgress?.({ phase: 'done', progress: 100 });

  // Get the GIF bytes
  const bytes = gif.bytes();
  return new Blob([bytes], { type: 'image/gif' });
}

/**
 * Convert/resize a video blob to WebM format
 * Plays video through canvas at target resolution and re-records
 */
export async function convertToWebm(
  videoBlob: Blob,
  onProgress?: (progress: ConversionProgress) => void,
  resolution: VideoResolution = 'original'
): Promise<Blob> {
  onProgress?.({ phase: 'extracting', progress: 0 });

  // Create video element
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;

  // Load video
  const videoUrl = URL.createObjectURL(videoBlob);
  video.src = videoUrl;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Failed to load video'));
  });

  await new Promise<void>((resolve) => {
    video.oncanplaythrough = () => resolve();
    video.load();
  });

  const duration = video.duration;

  // Calculate dimensions based on resolution setting
  const maxWidth = resolution === 'original' ? Infinity : resolution;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.floor(video.videoWidth * scale);
  const height = Math.floor(video.videoHeight * scale);

  // Create canvas for rendering
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Get canvas stream and set up MediaRecorder
  const canvasStream = canvas.captureStream(30); // 30 fps
  const chunks: Blob[] = [];

  const recorder = new MediaRecorder(canvasStream, {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 2500000,
  });

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  // Start recording
  recorder.start(100);

  onProgress?.({ phase: 'encoding', progress: 10 });

  // Play video and draw to canvas
  video.currentTime = 0;
  await video.play();

  // Draw frames while video plays
  const drawFrame = () => {
    if (video.ended || video.paused) return;
    ctx.drawImage(video, 0, 0, width, height);

    const progress = Math.min(90, 10 + (video.currentTime / duration) * 80);
    onProgress?.({ phase: 'encoding', progress: Math.round(progress) });

    requestAnimationFrame(drawFrame);
  };

  drawFrame();

  // Wait for video to finish
  await new Promise<void>((resolve) => {
    video.onended = () => resolve();
  });

  // Stop recording and get final blob
  recorder.stop();

  const finalBlob = await new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: 'video/webm' }));
    };
  });

  // Cleanup
  URL.revokeObjectURL(videoUrl);

  onProgress?.({ phase: 'done', progress: 100 });

  return finalBlob;
}
