import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    InvalidScheduledAttachmentError,
    resolveScheduledAttachments,
} from './ScheduledAttachmentResolver';

describe('resolveScheduledAttachments', () => {
    let uploadsDir: string;
    const originalUploadsDir = process.env.UPLOADS_DIR;

    beforeEach(async () => {
        uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduled-attachments-'));
        process.env.UPLOADS_DIR = uploadsDir;
        await fs.mkdir(path.join(uploadsDir, 'attachments', 'account-a'), { recursive: true });
        await fs.mkdir(path.join(uploadsDir, 'attachments', 'account-b'), { recursive: true });
        await fs.writeFile(path.join(uploadsDir, 'attachments', 'account-a', 'owned.pdf'), 'owned');
        await fs.writeFile(path.join(uploadsDir, 'attachments', 'account-b', 'foreign.pdf'), 'foreign');
    });

    afterEach(async () => {
        if (originalUploadsDir === undefined) delete process.env.UPLOADS_DIR;
        else process.env.UPLOADS_DIR = originalUploadsDir;
        await fs.rm(uploadsDir, { recursive: true, force: true });
    });

    it('rejects an absolute server path', async () => {
        await expect(resolveScheduledAttachments([{
            storageKey: '/etc/passwd',
            filename: 'passwd',
            contentType: 'text/plain',
        }], 'account-a')).rejects.toBeInstanceOf(InvalidScheduledAttachmentError);
    });

    it('rejects traversal', async () => {
        await expect(resolveScheduledAttachments([{
            storageKey: '../account-b/foreign.pdf',
            filename: 'foreign.pdf',
            contentType: 'application/pdf',
        }], 'account-a')).rejects.toBeInstanceOf(InvalidScheduledAttachmentError);
    });

    it('rejects a symlink to another account upload', async () => {
        await fs.symlink(
            path.join(uploadsDir, 'attachments', 'account-b', 'foreign.pdf'),
            path.join(uploadsDir, 'attachments', 'account-a', 'foreign-link'),
        );

        await expect(resolveScheduledAttachments([{
            storageKey: 'foreign-link',
            filename: 'foreign.pdf',
            contentType: 'application/pdf',
        }], 'account-a')).rejects.toBeInstanceOf(InvalidScheduledAttachmentError);
    });

    it('resolves a valid account-owned upload without persisting its server path', async () => {
        const result = await resolveScheduledAttachments([{
            storageKey: 'owned.pdf',
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
        }], 'account-a');

        expect(result.references).toEqual([{
            storageKey: 'owned.pdf',
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
        }]);
        expect(result.attachments[0].path).toBe(
            path.join(uploadsDir, 'attachments', 'account-a', 'owned.pdf'),
        );
    });
});
