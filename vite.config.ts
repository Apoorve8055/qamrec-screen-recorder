import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { renameSync, existsSync, rmSync, readFileSync, writeFileSync } from 'fs';

// Plugin to move HTML files to dist root after build and fix paths
function moveHtmlPlugin(): Plugin {
  return {
    name: 'move-html-plugin',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');

      // Function to fix asset and favicon paths in HTML
      const fixPaths = (html: string): string => {
        // Replace ../../assets/ or ../assets/ with ./assets/
        let fixed = html.replace(/(?:\.\.\/)+assets\//g, './assets/');
        // Fix favicon paths - replace ../../icons/ or ../icons/ or /icons/ with ./icons/
        fixed = fixed.replace(/href="(?:\.\.\/)+icons\//g, 'href="./icons/');
        fixed = fixed.replace(/href="\/icons\//g, 'href="./icons/');
        return fixed;
      };

      // Move and fix popup.html
      const popupSrc = resolve(distDir, 'src/popup/popup.html');
      const popupDest = resolve(distDir, 'popup.html');
      if (existsSync(popupSrc)) {
        const content = readFileSync(popupSrc, 'utf-8');
        writeFileSync(popupDest, fixPaths(content));
      }

      // Move and fix recorder.html
      const recorderSrc = resolve(distDir, 'src/recorder/recorder.html');
      const recorderDest = resolve(distDir, 'recorder.html');
      if (existsSync(recorderSrc)) {
        const content = readFileSync(recorderSrc, 'utf-8');
        writeFileSync(recorderDest, fixPaths(content));
      }

      // Clean up empty src directory
      const srcDir = resolve(distDir, 'src');
      if (existsSync(srcDir)) {
        rmSync(srcDir, { recursive: true, force: true });
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), moveHtmlPlugin()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        recorder: resolve(__dirname, 'src/recorder/recorder.html'),
        background: resolve(__dirname, 'src/background/background.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
