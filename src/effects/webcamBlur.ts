import type { ImageSegmenter } from '@mediapipe/tasks-vision';

/** Segmentation runs on a small copy of the frame; the mask is scaled back up */
const SEGMENT_WIDTH = 320;

/**
 * Webcam background blur using MediaPipe selfie segmentation.
 * The WASM runtime and model ship inside the extension; nothing is fetched from the network.
 */
export class BackgroundBlur {
  private small: OffscreenCanvas;
  private mask: OffscreenCanvas;
  private person: OffscreenCanvas;
  private out: OffscreenCanvas;

  private constructor(private segmenter: ImageSegmenter) {
    this.small = new OffscreenCanvas(1, 1);
    this.mask = new OffscreenCanvas(1, 1);
    this.person = new OffscreenCanvas(1, 1);
    this.out = new OffscreenCanvas(1, 1);
  }

  static async create(): Promise<BackgroundBlur> {
    // Loaded on demand so the editor doesn't pay for MediaPipe unless blur is used
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('mediapipe'));
    const segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: chrome.runtime.getURL('models/selfie_segmenter.tflite'),
        delegate: 'CPU',
      },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    return new BackgroundBlur(segmenter);
  }

  /** Returns a canvas the size of the frame with the background blurred */
  process(frame: CanvasImageSource, width: number, height: number, blurPx: number): OffscreenCanvas {
    const sw = SEGMENT_WIDTH;
    const sh = Math.max(1, Math.round((height / width) * sw));
    resize(this.small, sw, sh);
    const sctx = this.small.getContext('2d', { willReadFrequently: true })!;
    sctx.drawImage(frame, 0, 0, sw, sh);

    const result = this.segmenter.segment(this.small);
    const masks = result.confidenceMasks ?? [];
    const personMask = masks[masks.length - 1];
    resize(this.mask, personMask ? personMask.width : sw, personMask ? personMask.height : sh);
    if (personMask) {
      const conf = personMask.getAsFloat32Array();
      const img = new ImageData(personMask.width, personMask.height);
      for (let i = 0; i < conf.length; i++) {
        img.data[i * 4 + 3] = Math.round(conf[i] * 255);
      }
      this.mask.getContext('2d')!.putImageData(img, 0, 0);
    }
    result.close();

    resize(this.out, width, height);
    resize(this.person, width, height);
    const octx = this.out.getContext('2d')!;
    const pctx = this.person.getContext('2d')!;

    // Blurred background, drawn slightly oversized so blurred edges don't go transparent
    octx.save();
    octx.filter = `blur(${blurPx}px)`;
    const bleed = blurPx * 2;
    octx.drawImage(frame, -bleed, -bleed, width + bleed * 2, height + bleed * 2);
    octx.restore();

    // Sharp person, cut out with a softened mask
    pctx.globalCompositeOperation = 'source-over';
    pctx.clearRect(0, 0, width, height);
    pctx.drawImage(frame, 0, 0, width, height);
    pctx.globalCompositeOperation = 'destination-in';
    pctx.filter = 'blur(2px)';
    pctx.drawImage(this.mask, 0, 0, width, height);
    pctx.filter = 'none';
    pctx.globalCompositeOperation = 'source-over';

    octx.drawImage(this.person, 0, 0);
    return this.out;
  }

  close(): void {
    this.segmenter.close();
  }
}

function resize(canvas: OffscreenCanvas, width: number, height: number) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

let shared: Promise<BackgroundBlur> | null = null;

/** Lazily loads one shared segmenter; resolves to null if it can't load */
export function getBackgroundBlur(): Promise<BackgroundBlur | null> {
  if (!shared) shared = BackgroundBlur.create();
  return shared.catch((err) => {
    console.warn('Background blur unavailable:', err);
    shared = null;
    return null;
  });
}
