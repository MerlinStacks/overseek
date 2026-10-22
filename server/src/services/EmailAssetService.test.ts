import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishEmailAsset } from './EmailAssetService';

let directory: string | undefined;
afterEach(async () => { vi.unstubAllEnvs(); if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });
describe('immutable email assets', () => {
    it('normalizes to PNG, deduplicates identical content and separates tenants', async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), 'email-assets-test-'));
        vi.stubEnv('UPLOADS_DIR', directory); vi.stubEnv('PUBLIC_ASSET_URL', 'https://assets.example.test');
        const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#f00' } }).webp().toBuffer();
        const first = await publishEmailAsset('account-one', bytes);
        expect(await publishEmailAsset('account-one', bytes)).toEqual(first);
        const second = await publishEmailAsset('account-two', bytes);
        expect(second.url).not.toBe(first.url); expect(second.hash).toBe(first.hash);
        const stored = await readFile(path.join(directory, new URL(first.url).pathname.replace('/uploads/', '')));
        expect(await sharp(stored).metadata()).toMatchObject({ format: 'png', width: 8, height: 6 });
        expect(first).toMatchObject({ immutable: true, type: 'image/png' });
    });
    it('rejects non-HTTPS origins, oversized files and SVG content', async () => {
        vi.stubEnv('PUBLIC_ASSET_URL', 'http://localhost');
        await expect(publishEmailAsset('account', Buffer.from('x'))).rejects.toThrow('HTTPS');
        vi.stubEnv('PUBLIC_ASSET_URL', 'https://assets.test');
        await expect(publishEmailAsset('account', Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow('5 MB');
        await expect(publishEmailAsset('account', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'))).rejects.toThrow('SVG');
    });
});
