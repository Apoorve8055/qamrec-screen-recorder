/**
 * Download utilities for saving recordings locally
 */

/**
 * Save a blob to disk, asking the user where to save it.
 * Uses the Chrome downloads API, falling back to a plain browser download.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  // Revoke once the download has had time to start
  const cleanup = () => setTimeout(() => URL.revokeObjectURL(url), 60_000);

  try {
    await new Promise<void>((resolve, reject) => {
      chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (downloadId === undefined) reject(new Error('Download failed'));
        else resolve();
      });
    });
  } catch {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    cleanup();
  }
}
