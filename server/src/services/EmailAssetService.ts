import sharp from 'sharp';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { getPublicUploadsDir } from '../utils/uploadPaths';

export async function publishEmailAsset(accountId: string, bytes: Buffer) {
    const base = new URL(process.env.PUBLIC_ASSET_URL || process.env.API_URL || '');
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Configure a public HTTPS PUBLIC_ASSET_URL or API_URL before uploading email assets');
    if (bytes.length > 5 * 1024 * 1024) throw new Error('Email image exceeds 5 MB');
    const image = sharp(bytes, { limitInputPixels: 20_000_000, sequentialRead: true });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'gif', 'webp'].includes(metadata.format || '')) throw new Error('Upload a PNG, JPEG, GIF or WebP image; SVG is not supported for email delivery');
    // Normalize to a universally supported raster; strips metadata and external
    // references. GIF/WebP animations deliberately use their first frame.
    const { data, info } = await image.rotate().png().toBuffer({ resolveWithObject: true });
    if (data.length > 10 * 1024 * 1024) throw new Error('Normalized email image exceeds 10 MB');
    const owner = createHash('sha256').update(accountId).digest('hex').slice(0, 24);
    const hash = createHash('sha256').update(data).digest('hex');
    const directory = path.join(getPublicUploadsDir(), 'email-assets', owner);
    await mkdir(directory, { recursive: true });
    try { await writeFile(path.join(directory, `${hash}.png`), data, { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    return { url: `${base.origin}/uploads/email-assets/${owner}/${hash}.png`, hash, width: info.width, height: info.height, type: 'image/png', immutable: true, firstFrameOnly: (metadata.pages || 1) > 1 };
}
