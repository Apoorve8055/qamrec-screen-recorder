import { defineConfig } from 'vite';
import { resolve } from 'path';

// The page tracker is injected with chrome.scripting.executeScript, which needs a single
// classic script (no module imports), so it is built separately as a self-contained IIFE.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/tracker/tracker.ts'),
      formats: ['iife'],
      name: 'QamrecTracker',
      fileName: () => 'tracker.js',
    },
  },
});
