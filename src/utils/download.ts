/**
 * Download utilities for saving recordings locally
 */

/**
 * Generate a filename with timestamp
 */
export function generateFilename(prefix: string = 'recording', extension: string = 'webm'): string {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  return `${prefix}-${timestamp}.${extension}`;
}

/**
 * Download a blob using Chrome downloads API
 */
export async function downloadBlob(
  blob: Blob,
  filename?: string,
  extension: string = 'webm'
): Promise<number> {
  const url = URL.createObjectURL(blob);
  const finalFilename = filename || generateFilename('recording', extension);

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename: finalFilename,
        saveAs: true,
      },
      (downloadId) => {
        // Clean up the object URL after a delay
        setTimeout(() => URL.revokeObjectURL(url), 60000);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (downloadId === undefined) {
          reject(new Error('Download failed'));
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}

/**
 * Download a blob using standard browser download (fallback)
 */
export function downloadBlobFallback(
  blob: Blob,
  filename?: string,
  extension: string = 'webm'
): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || generateFilename('recording', extension);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Clean up the object URL after a delay
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Get the size of a blob in a human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
