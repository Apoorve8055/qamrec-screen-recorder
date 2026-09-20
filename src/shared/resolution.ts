import type { ExportResolution } from './types';

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** Output dimensions for a resolution preset: scales by height, never upscales, keeps sizes even */
export function outputSize(
  srcWidth: number,
  srcHeight: number,
  resolution: ExportResolution
): { width: number; height: number } {
  if (resolution === 'original' || resolution >= srcHeight) {
    return { width: even(srcWidth), height: even(srcHeight) };
  }
  return { width: even((srcWidth * resolution) / srcHeight), height: even(resolution) };
}

export function resolutionLabel(resolution: ExportResolution): string {
  return resolution === 'original' ? 'original' : `${resolution}p`;
}
