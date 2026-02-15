/**
 * Generates transparent-background notification icons from app-icon.png.
 *
 * Why: PWA push notification icons need transparent backgrounds:
 * - Android clips notification icons into circles; a white bg fills the circle.
 * - Badge icons (status bar) must be monochrome white silhouettes on transparent bg.
 *
 * This script:
 * 1. Removes the white/light background from app-icon.png
 * 2. Generates a 192px notification icon (full-color on transparent)
 * 3. Generates a 72px badge icon (white silhouette on transparent)
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');
const APP_ICON = path.join(__dirname, '..', 'public', 'app-icon.png');

async function generateNotificationIcon() {
    const img = sharp(APP_ICON);
    const { width, height } = await img.metadata();

    // Extract raw pixel data to remove the white/near-white background
    const { data, info } = await img
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const channels = info.channels; // 4 (RGBA)

    for (let i = 0; i < data.length; i += channels) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Detect white/near-white and light gray pixels (background + rounded corner area)
        // Threshold: if all RGB channels are above 220, treat as background
        if (r > 220 && g > 220 && b > 220) {
            data[i + 3] = 0; // Set alpha to fully transparent
        }

        // Also handle the subtle gradient/shadow around the rounded rect
        // If very light (> 200) and low saturation, fade proportionally
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max;

        if (max > 200 && saturation < 0.1) {
            // Fade alpha based on brightness — brighter = more transparent
            const brightness = (r + g + b) / 3;
            const alpha = Math.max(0, Math.round(255 * (1 - (brightness - 180) / 75)));
            data[i + 3] = Math.min(data[i + 3], alpha);
        }
    }

    // Create the full-color notification icon at 192px
    await sharp(data, {
        raw: {
            width: info.width,
            height: info.height,
            channels: info.channels,
        },
    })
        .resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(path.join(ICONS_DIR, 'notification-icon.png'));

    console.log('✅ Generated notification-icon.png (192x192, transparent bg)');

    // Create the monochrome white badge icon at 72px
    // Convert all non-transparent pixels to white
    const badgeData = Buffer.from(data);
    for (let i = 0; i < badgeData.length; i += channels) {
        if (badgeData[i + 3] > 0) {
            // Non-transparent pixel → make it solid white
            badgeData[i] = 255;     // R
            badgeData[i + 1] = 255; // G
            badgeData[i + 2] = 255; // B
            // Keep existing alpha
        }
    }

    await sharp(badgeData, {
        raw: {
            width: info.width,
            height: info.height,
            channels: info.channels,
        },
    })
        .resize(72, 72, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(path.join(ICONS_DIR, 'notification-badge.png'));

    console.log('✅ Generated notification-badge.png (72x72, white silhouette)');
}

generateNotificationIcon().catch((err) => {
    console.error('❌ Failed to generate notification icons:', err);
    process.exit(1);
});
