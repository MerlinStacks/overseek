/* eslint-disable no-undef, @typescript-eslint/no-unused-vars */
/**
 * PWA Icon Generator
 * 
 * Generates all required PWA icon sizes from the source app-icon.png.
 * Run with: node scripts/generate-icons.js
 */

import sharp from 'sharp';
import { mkdir, copyFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_ICON = join(__dirname, '../public/app-icon.png');
const OUTPUT_DIR = join(__dirname, '../public/icons');

const SIZES = [16, 32, 72, 96, 128, 144, 152, 192, 384, 512];

async function generateIcons() {
    console.log('🎨 Generating PWA icons...\n');

    // Ensure output directory exists
    await mkdir(OUTPUT_DIR, { recursive: true });

    // Generate standard icons
    for (const size of SIZES) {
        const outputPath = join(OUTPUT_DIR, `icon-${size}.png`);
        await sharp(SOURCE_ICON)
            .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .png()
            .toFile(outputPath);
        console.log(`✅ Generated icon-${size}.png`);
    }

    // Generate maskable icon (with padding for safe zone)
    const maskableSize = 512;
    const iconSize = Math.floor(maskableSize * 0.8); // 80% of canvas for safe zone
    const padding = Math.floor((maskableSize - iconSize) / 2);

    await sharp(SOURCE_ICON)
        .resize(iconSize, iconSize, { fit: 'contain' })
        .extend({
            top: padding,
            bottom: padding,
            left: padding,
            right: padding,
            background: { r: 79, g: 70, b: 229, alpha: 1 } // #4f46e5 theme color
        })
        .png()
        .toFile(join(OUTPUT_DIR, 'icon-maskable-512.png'));
    console.log('✅ Generated icon-maskable-512.png');

    // Generate shortcut icons
    const shortcutSize = 96;

    // Orders shortcut - reuse main icon for now
    await sharp(SOURCE_ICON)
        .resize(shortcutSize, shortcutSize)
        .png()
        .toFile(join(OUTPUT_DIR, 'shortcut-orders.png'));
    console.log('✅ Generated shortcut-orders.png');

    // Inbox shortcut - reuse main icon for now
    await sharp(SOURCE_ICON)
        .resize(shortcutSize, shortcutSize)
        .png()
        .toFile(join(OUTPUT_DIR, 'shortcut-inbox.png'));
    console.log('✅ Generated shortcut-inbox.png');

    console.log('\n🎉 All icons generated successfully!');
}

generateIcons().catch(console.error);
