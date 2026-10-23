import Fastify from 'fastify';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleParser } from 'mailparser';
import { storeIncomingAttachments } from '../../services/incomingAttachments';

const m = vi.hoisted(() => ({ findFirst: vi.fn(), permission: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { message: { findFirst: m.findFirst } } }));
vi.mock('../../services/PermissionService', () => ({ PermissionService: { hasPermission: m.permission } }));
vi.mock('../../middleware/auth', () => ({ requireAuthFastify: async (request: any, reply: any) => {
    if (request.headers.authorization !== 'Bearer valid') return reply.code(401).send();
    request.user = { id: 'reader' };
    request.accountId = request.headers['x-account-id'];
} }));
import { inboxAttachmentRoutes, referencedAttachmentNames } from './attachments';

describe('private inbox attachments', () => {
    let root: string;
    let app: ReturnType<typeof Fastify>;
    const headers = { authorization: 'Bearer valid', 'x-account-id': 'account-a' };
    const url = (filename: string) => `/api/chat/messages/message-a/attachments/${encodeURIComponent(filename)}`;
    beforeEach(async () => {
        vi.clearAllMocks();
        root = await mkdtemp(path.join(os.tmpdir(), 'private-inbox-'));
        vi.stubEnv('UPLOADS_DIR', root);
        await mkdir(path.join(root, 'attachments'));
        m.permission.mockResolvedValue(true);
        m.findFirst.mockResolvedValue({ content: '<img src="/uploads/attachments/photo.jpg">' });
        await writeFile(path.join(root, 'attachments', 'photo.jpg'), Buffer.from('jpeg bytes'));
        app = Fastify();
        await app.register(inboxAttachmentRoutes, { prefix: '/api/chat' });
    });
    afterEach(async () => {
        await app.close();
        vi.unstubAllEnvs();
        await rm(root, { recursive: true, force: true });
    });

    it('serves exact inline bytes through a message/account-scoped authorized read', async () => {
        const result = await app.inject({ url: url('photo.jpg'), headers });
        expect(result.statusCode).toBe(200);
        expect(result.rawPayload).toEqual(Buffer.from('jpeg bytes'));
        expect(result.headers['content-type']).toBe('image/jpeg');
        expect(result.headers['cache-control']).toBe('private, no-store');
        expect(m.findFirst).toHaveBeenCalledWith({ where: { id: 'message-a', conversation: { accountId: 'account-a' } }, select: { content: true } });
        expect(m.permission).toHaveBeenCalledWith('reader', 'account-a', 'view_inbox');
    });

    it('rejects anonymous reads, missing account context and revoked inbox permission', async () => {
        expect((await app.inject(url('photo.jpg'))).statusCode).toBe(401);
        expect((await app.inject({ url: url('photo.jpg'), headers: { authorization: 'Bearer valid' } })).statusCode).toBe(401);
        m.permission.mockResolvedValue(false);
        expect((await app.inject({ url: url('photo.jpg'), headers })).statusCode).toBe(403);
        expect(m.findFirst).not.toHaveBeenCalled();
    });

    it('does not serve cross-account/missing messages or unreferenced files and CID prefixes', async () => {
        m.findFirst.mockResolvedValueOnce(null);
        expect((await app.inject({ url: url('photo.jpg'), headers: { ...headers, 'x-account-id': 'account-b' } })).statusCode).toBe(404);
        expect((await app.inject({ url: url('other.jpg'), headers })).statusCode).toBe(404);
        expect((await app.inject({ url: url('photo'), headers })).statusCode).toBe(404);
    });

    it('rejects traversal, nested paths and symlinks even if referenced', async () => {
        await writeFile(path.join(root, 'private.jpg'), 'private');
        await symlink(path.join(root, 'private.jpg'), path.join(root, 'attachments', 'escape.jpg'));
        m.findFirst.mockResolvedValue({ content: '<img src="/uploads/attachments/escape.jpg"><img src="/uploads/attachments/..%2Fprivate.jpg">' });
        expect((await app.inject({ url: url('escape.jpg'), headers })).statusCode).toBe(404);
        expect((await app.inject({ url: url('../private.jpg'), headers })).statusCode).toBe(404);
        expect((await app.inject({ url: url('folder\\private.jpg'), headers })).statusCode).toBe(404);
    });

    it('preserves encoded/legacy download filenames and forces active formats to download', async () => {
        const filename = '100% artwork (final (2)).svg';
        await writeFile(path.join(root, 'attachments', filename), '<svg/>');
        m.findFirst.mockResolvedValue({ content: `[Attachment: ${filename}](https://app.example/uploads/attachments/${filename})` });
        const result = await app.inject({ url: url(filename), headers });
        expect(result.statusCode).toBe(200);
        expect(result.body).toBe('<svg/>');
        expect(result.headers['content-type']).toBe('application/octet-stream');
        expect(result.headers['content-disposition']).toMatch(/^attachment;/);
    });

    it('returns 404 for a referenced file missing from disk', async () => {
        m.findFirst.mockResolvedValue({ content: '<img src="/uploads/attachments/missing.jpg">' });
        expect((await app.inject({ url: url('missing.jpg'), headers })).statusCode).toBe(404);
    });

    it('round-trips a Gmail-style related JPEG from MIME ingestion to the private read', async () => {
        const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
        const parsed = await simpleParser([
            'From: customer@example.com', 'MIME-Version: 1.0', 'Content-Type: multipart/related; boundary="photo"', '',
            '--photo', 'Content-Type: text/html', '', '<div>Please see photos attached<br><img src="cid:ii_photo"></div>',
            '--photo', 'Content-Type: image/jpeg; name="1000023950.jpg"', 'Content-ID: <ii_photo>',
            'Content-Disposition: inline; filename="1000023950.jpg"', 'Content-Transfer-Encoding: base64', '', bytes.toString('base64'), '--photo--',
        ].join('\r\n'), { skipImageLinks: true });
        const stored = storeIncomingAttachments(parsed);
        m.findFirst.mockResolvedValue({ content: stored.html });
        const name = [...referencedAttachmentNames(String(stored.html))][0];
        const result = await app.inject({ url: url(name), headers });
        expect(result.statusCode).toBe(200);
        expect(result.rawPayload).toEqual(bytes);
    });
});
