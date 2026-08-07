import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_PIXELS = 40_000_000;
const CACHE_MAX_BYTES = 100 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const imageCache = new Map<string, { buffer: Buffer; expiresAt: number }>();
let imageCacheBytes = 0;

export function clearPrivateImageCache() { imageCache.clear(); imageCacheBytes = 0; }
export function privateImageCacheStats() { return { entries: imageCache.size, bytes: imageCacheBytes, maxBytes: CACHE_MAX_BYTES }; }
export function imageCacheEntryFresh(expiresAt: number, now = Date.now()) { return expiresAt > now; }
export function oldestCacheEvictionCount(sizes: number[], maxBytes = CACHE_MAX_BYTES) {
    let total = sizes.reduce((sum, size) => sum + size, 0);
    let count = 0;
    while (total > maxBytes && count < sizes.length) total -= sizes[count++];
    return count;
}

function cachedImage(key: string, now = Date.now()) {
    const entry = imageCache.get(key);
    if (!entry) return null;
    if (!imageCacheEntryFresh(entry.expiresAt, now)) {
        imageCache.delete(key); imageCacheBytes -= entry.buffer.length; return null;
    }
    imageCache.delete(key); imageCache.set(key, entry);
    return entry.buffer;
}

export function cachePrivateImage(key: string, buffer: Buffer, now = Date.now()) {
    const previous = imageCache.get(key);
    if (previous) imageCacheBytes -= previous.buffer.length;
    imageCache.delete(key);
    imageCache.set(key, { buffer, expiresAt: now + CACHE_TTL_MS });
    imageCacheBytes += buffer.length;
    const evictions = oldestCacheEvictionCount([...imageCache.values()].map(entry => entry.buffer.length));
    for (let index = 0; index < evictions; index++) {
        const oldest = imageCache.entries().next().value as [string, { buffer: Buffer }] | undefined;
        if (!oldest) break;
        imageCache.delete(oldest[0]); imageCacheBytes -= oldest[1].buffer.length;
    }
}

export function imageDimensions(image: Buffer): { width: number; height: number; type: 'jpeg' | 'png' | 'webp' } {
    let width = 0;
    let height = 0;
    let type: 'jpeg' | 'png' | 'webp' | null = null;
    if (image.length >= 24 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        type = 'png'; width = image.readUInt32BE(16); height = image.readUInt32BE(20);
    } else if (image.length >= 12 && image.subarray(0, 4).toString('ascii') === 'RIFF' && image.subarray(8, 12).toString('ascii') === 'WEBP') {
        type = 'webp';
        const format = image.subarray(12, 16).toString('ascii');
        if (format === 'VP8X' && image.length >= 30) {
            width = 1 + image.readUIntLE(24, 3); height = 1 + image.readUIntLE(27, 3);
        } else if (format === 'VP8L' && image.length >= 25 && image[20] === 0x2f) {
            const bits = image.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
        } else if (format === 'VP8 ' && image.length >= 30 && image[23] === 0x9d && image[24] === 0x01 && image[25] === 0x2a) {
            width = image.readUInt16LE(26) & 0x3fff; height = image.readUInt16LE(28) & 0x3fff;
        }
    } else if (image.length >= 4 && image[0] === 0xff && image[1] === 0xd8) {
        type = 'jpeg';
        let offset = 2;
        while (offset + 9 < image.length) {
            if (image[offset] !== 0xff) { offset++; continue; }
            const marker = image[offset + 1];
            if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
            const length = image.readUInt16BE(offset + 2);
            if (length < 2 || offset + 2 + length > image.length) break;
            if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
                height = image.readUInt16BE(offset + 5); width = image.readUInt16BE(offset + 7); break;
            }
            offset += 2 + length;
        }
    } else {
        throw new Error('Remote image data rejected');
    }
    if (!type || !width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width * height > MAX_PIXELS) {
        throw new Error('Remote image dimensions rejected');
    }
    return { width, height, type };
}

function blockedAddress(address: string): boolean {
    if (net.isIPv4(address)) {
        const parts = address.split('.').map(Number);
        return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] === 169 && parts[1] === 254
            || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168
            || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127 || parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19
            || parts[0] >= 224 || address === '100.100.100.200';
    }
    const normalized = address.toLowerCase().split('%')[0];
    if (normalized.startsWith('::ffff:')) return blockedAddress(normalized.slice(7));
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fe80:')
        || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('ff')
        || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:169.254.');
}

export async function validateRemoteImageUrl(rawUrl: string): Promise<{ url: URL; address: string; family: number }> {
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new Error('Invalid image URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported image URL');
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'metadata.google.internal') throw new Error('Blocked image host');
    const addresses = net.isIP(hostname)
        ? [{ address: hostname, family: net.isIP(hostname) }]
        : await dns.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(item => blockedAddress(item.address))) throw new Error('Blocked image address');
    return { url, address: addresses[0].address, family: addresses[0].family };
}

export async function fetchImageSecurely(rawUrl: string, redirects = 0, deadline = Date.now() + 30 * 60 * 1000): Promise<Buffer> {
    if (redirects > 3) throw new Error('Too many image redirects');
    if (Date.now() >= deadline) throw new Error('Generation timed out');
    const resolved = await validateRemoteImageUrl(rawUrl);
    const cacheKey = resolved.url.toString();
    const hit = cachedImage(cacheKey);
    if (hit) return hit;
    return new Promise((resolve, reject) => {
        const transport = resolved.url.protocol === 'https:' ? https : http;
        const request = transport.get(resolved.url, {
            headers: { Accept: 'image/png,image/jpeg,image/webp', 'User-Agent': 'Overseek-Wholesale-Renderer/1.0' },
            lookup: (_hostname, _options, callback: any) => callback(null, resolved.address, resolved.family),
            timeout: Math.min(TIMEOUT_MS, Math.max(1, deadline - Date.now())),
        }, response => {
            const status = response.statusCode || 0;
            if (status >= 300 && status < 400 && response.headers.location) {
                response.resume();
                const next = new URL(response.headers.location, resolved.url).toString();
                fetchImageSecurely(next, redirects + 1, deadline).then(resolve, reject);
                return;
            }
            const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            if (status !== 200 || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
                response.resume();
                reject(new Error('Remote image response rejected'));
                return;
            }
            const declaredLength = Number(response.headers['content-length'] || 0);
            if (declaredLength > MAX_BYTES) {
                response.destroy();
                reject(new Error('Remote image exceeds size limit'));
                return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_BYTES) response.destroy(new Error('Remote image exceeds size limit'));
                else chunks.push(Buffer.from(chunk));
            });
            response.on('end', () => {
                const image = Buffer.concat(chunks);
                try { imageDimensions(image); cachePrivateImage(cacheKey, image); resolve(image); }
                catch (error) { reject(error); }
            });
            response.on('error', reject);
        });
        request.on('timeout', () => request.destroy(new Error('Remote image timed out')));
        request.on('error', reject);
    });
}
