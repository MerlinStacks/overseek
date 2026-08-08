import { promises as fs } from 'fs';
import Fastify from 'fastify';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
    conversation: { findFirst: vi.fn() },
    message: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../utils/prisma', () => ({ prisma: prismaMocks }));
vi.mock('../../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => {
        request.user = { id: 'user-1' };
        request.accountId = 'account-a';
    },
}));
vi.mock('../../utils/logger', () => ({
    Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../utils/cache', () => ({ invalidateCache: vi.fn() }));
vi.mock('./authorization', () => ({ requireInboxMutationAccess: vi.fn().mockResolvedValue(true) }));

import { schedulingRoutes } from './scheduling';

describe('scheduled attachment route security', () => {
    let app: ReturnType<typeof Fastify>;
    let uploadsDir: string;
    const originalUploadsDir = process.env.UPLOADS_DIR;

    beforeEach(async () => {
        vi.clearAllMocks();
        uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'schedule-route-'));
        process.env.UPLOADS_DIR = uploadsDir;
        await fs.mkdir(path.join(uploadsDir, 'attachments', 'account-a'), { recursive: true });
        await fs.writeFile(path.join(uploadsDir, 'attachments', 'account-a', 'owned.txt'), 'owned');
        prismaMocks.conversation.findFirst.mockResolvedValue({ id: 'conversation-1' });
        prismaMocks.message.create.mockResolvedValue({ id: 'message-1' });

        app = Fastify();
        await app.register(schedulingRoutes);
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        if (originalUploadsDir === undefined) delete process.env.UPLOADS_DIR;
        else process.env.UPLOADS_DIR = originalUploadsDir;
        await fs.rm(uploadsDir, { recursive: true, force: true });
    });

    it('rejects client-provided paths before creating the schedule', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages/schedule',
            payload: {
                content: 'Later',
                scheduledFor: new Date(Date.now() + 60_000).toISOString(),
                attachments: [{ filename: 'passwd', path: '/etc/passwd', contentType: 'text/plain' }],
            },
        });

        expect(response.statusCode).toBe(400);
        expect(prismaMocks.message.create).not.toHaveBeenCalled();
    });

    it('stores only a valid account-owned attachment reference', async () => {
        const reference = { storageKey: 'owned.txt', filename: 'owned.txt', contentType: 'text/plain' };
        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages/schedule',
            payload: {
                content: 'Later',
                scheduledFor: new Date(Date.now() + 60_000).toISOString(),
                attachments: [reference],
            },
        });

        expect(response.statusCode).toBe(200);
        expect(prismaMocks.message.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ attachmentPaths: [reference] }),
        });
    });
});
