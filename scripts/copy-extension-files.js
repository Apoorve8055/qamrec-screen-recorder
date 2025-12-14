/**
 * Post-build script to copy extension files to dist
 */

import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
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

// Copy ffmpeg folder
const ffmpegSrcDir = join(rootDir, 'public', 'ffmpeg');
const ffmpegDistDir = join(distDir, 'ffmpeg');
if (existsSync(ffmpegSrcDir)) {
  if (!existsSync(ffmpegDistDir)) {
    mkdirSync(ffmpegDistDir, { recursive: true });
  }
  const ffmpegFiles = readdirSync(ffmpegSrcDir);
  for (const file of ffmpegFiles) {
    const src = join(ffmpegSrcDir, file);
    const dest = join(ffmpegDistDir, file);
    copyFileSync(src, dest);
    console.log(`Copied: ffmpeg/${file}`);
  }
}

// Read and modify manifest for production
const manifestSrc = join(rootDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestSrc, 'utf-8'));

// Update paths for production build
manifest.action.default_popup = 'popup.html';
manifest.background.service_worker = 'background.js';
manifest.web_accessible_resources = [
  {
    resources: ['recorder.html', 'assets/*', 'ffmpeg/*'],
    matches: ['<all_urls>']
  }
];

// Write modified manifest
writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Created: manifest.json');

console.log('Extension files copied successfully!');
