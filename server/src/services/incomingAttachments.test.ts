import { mkdtempSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleParser } from 'mailparser';
import { storeIncomingAttachments } from './incomingAttachments';

describe('incoming attachments', () => {
    let root: string;
    beforeEach(() => {
        root = mkdtempSync(path.join(os.tmpdir(), 'incoming-attachments-'));
        vi.stubEnv('UPLOADS_DIR', root);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        rmSync(root, { recursive: true, force: true });
    });
    const part = (overrides = {}) => ({
        filename: 'photo.png', contentType: 'image/png', content: Buffer.from('image bytes'), ...overrides,
    } as any);
    const stored = (url: string) => readFileSync(path.join(root, decodeURIComponent(url.replace('/uploads/', ''))));

    it.each([
        { filename: 'logo.png' },
        { filename: 'image001.png', contentDisposition: 'inline', size: 1000 },
        { related: true, contentId: '<unreferenced>' },
        { filename: undefined },
    ])('preserves attachments previously mistaken for signatures: %j', (overrides) => {
        const result = storeIncomingAttachments({ html: '<p>See attached</p>', attachments: [part(overrides)] });
        expect(result.attachments).toHaveLength(1);
        expect(stored(result.attachments[0].url)).toEqual(Buffer.from('image bytes'));
        expect(result.attachments[0].filename).toBeTruthy();
    });

    it('resolves encoded inline CIDs without replacing longer IDs sharing a prefix', () => {
        const result = storeIncomingAttachments({
            html: '<img src="CID:photo%40mail"><img src="cid:photo@mail2">',
            attachments: [part({ contentId: '<photo@mail>' })],
        });
        expect(result.html).toContain('src="/uploads/attachments/');
        expect(result.html).toContain('src="cid:photo@mail2"');
        expect(result.attachments).toEqual([]);
    });

    it('stores unsafe MIME filenames as a single encoded path segment', () => {
        const result = storeIncomingAttachments({ html: false, attachments: [part({ filename: '../folder\\053 dexter (1).webp' })] });
        expect(result.attachments[0].url).not.toMatch(/[()\\]/);
        expect(stored(result.attachments[0].url)).toEqual(Buffer.from('image bytes'));
    });

    it('preserves a real MIME attachment with an inline disposition and encoded CID', async () => {
        const parsed = await simpleParser([
            'From: customer@example.com', 'MIME-Version: 1.0',
            'Content-Type: multipart/related; boundary="parts"', '',
            '--parts', 'Content-Type: text/html', '', '<img src="cid:photo%40mail">',
            '--parts', 'Content-Type: image/png; name="image001.png"',
            'Content-ID: <photo@mail>', 'Content-Disposition: inline; filename="image001.png"',
            'Content-Transfer-Encoding: base64', '', 'aW1hZ2UgYnl0ZXM=', '--parts--',
        ].join('\r\n'), { skipImageLinks: true });
        const result = storeIncomingAttachments(parsed);
        const url = String(result.html).match(/src="([^"]+)"/)![1];
        expect(stored(url)).toEqual(Buffer.from('image bytes'));
    });
});
