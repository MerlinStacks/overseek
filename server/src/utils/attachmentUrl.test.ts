import { mkdtemp, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { expect, it } from 'vitest';
import { getAttachmentUrl } from './attachmentUrl';

it('serves the original SVG bytes through encoded attachment URLs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'attachment-url-'));
    const app = Fastify();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
    try {
        await app.register(fastifyStatic, { root, prefix: '/uploads/attachments/' });
        for (const filename of ['no glass (outlined)-02.svg', 'artwork (1).svg', 'artwork (final (2)).svg', '100% artwork.svg']) {
            await writeFile(path.join(root, filename), svg);
            const url = getAttachmentUrl(filename);
            expect(url).not.toMatch(/[()#?]/);
            const response = await app.inject({ method: 'GET', url });
            expect(response.statusCode, `${filename}: ${response.body}`).toBe(200);
            expect(response.body).toBe(svg);
        }
    } finally {
        await app.close();
        await rm(root, { recursive: true, force: true });
    }
});
