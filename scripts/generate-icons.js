/**
 * Generate square icons from original icons by adding transparent padding
 * Reads from public/icons/original/ and saves to public/icons/
 */

import { createCanvas, loadImage } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const iconsDir = join(__dirname, '..', 'public', 'icons');

// Target sizes for Chrome extension icons
const sizes = [16, 48, 128];

async function generateSquareIcons() {
  // Ensure directories exist
  if (!existsSync(iconsDir)) {
    mkdirSync(iconsDir, { recursive: true });
  }

  // Use source.png as the master image
  const sourceIconPath = join(iconsDir, 'source.png');

  if (!existsSync(sourceIconPath)) {
    console.error('Source icon not found:', sourceIconPath);
    console.log('Please ensure source.png exists in public/icons/');
    process.exit(1);
  }

  const sourceImage = await loadImage(sourceIconPath);
  const srcWidth = sourceImage.width;
  const srcHeight = sourceImage.height;

  console.log(`Source icon: ${srcWidth}x${srcHeight}`);

  for (const size of sizes) {
    // Create a square canvas
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Clear canvas with transparency
    ctx.clearRect(0, 0, size, size);

    // Calculate scaling to fit the icon within the square while maintaining aspect ratio
    const scale = Math.min(size / srcWidth, size / srcHeight);
    const scaledWidth = srcWidth * scale;
    const scaledHeight = srcHeight * scale;

    // Center the image on the canvas
    const offsetX = (size - scaledWidth) / 2;
    const offsetY = (size - scaledHeight) / 2;

    // Draw the scaled image centered
    ctx.drawImage(sourceImage, offsetX, offsetY, scaledWidth, scaledHeight);

    // Save the icon
    const outputPath = join(iconsDir, `icon${size}.png`);
    const buffer = canvas.toBuffer('image/png');
    writeFileSync(outputPath, buffer);
    console.log(`Generated: icon${size}.png (${size}x${size})`);
  }

  console.log('Done generating square icons!');
}

generateSquareIcons().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
