/**
 * Post-build script to copy extension files to dist
 */

import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');

// Ensure dist/icons directory exists
const iconsDistDir = join(distDir, 'icons');
if (!existsSync(iconsDistDir)) {
  mkdirSync(iconsDistDir, { recursive: true });
}

// Copy icons
const iconSizes = [16, 48, 128];
for (const size of iconSizes) {
  const src = join(rootDir, 'public', 'icons', `icon${size}.png`);
  const dest = join(iconsDistDir, `icon${size}.png`);
  if (existsSync(src)) {
    copyFileSync(src, dest);
    console.log(`Copied: icon${size}.png`);
  }
}

// Copy the MediaPipe runtime (background blur) - SIMD build only, supported by all target Chrome versions
const mediapipeSrc = join(rootDir, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const mediapipeDist = join(distDir, 'mediapipe');
mkdirSync(mediapipeDist, { recursive: true });
for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  copyFileSync(join(mediapipeSrc, file), join(mediapipeDist, file));
  console.log(`Copied: mediapipe/${file}`);
}

// Read and modify manifest for production
const manifestSrc = join(rootDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestSrc, 'utf-8'));

// Update paths for production build
manifest.action.default_popup = 'popup.html';
manifest.background.service_worker = 'background.js';

// Write modified manifest
writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Created: manifest.json');

console.log('Extension files copied successfully!');
