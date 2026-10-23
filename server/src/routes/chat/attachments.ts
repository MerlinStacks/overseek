import type { FastifyPluginAsync } from 'fastify';
import { open, realpath } from 'fs/promises';
import path from 'path';
import { requireAuthFastify } from '../../middleware/auth';
import { PermissionService } from '../../services/PermissionService';
import { prisma } from '../../utils/prisma';
import { getUploadsDir } from '../../utils/uploadPaths';

/** Read stored HTML/markdown references, including legacy filenames with spaces/parentheses. */
export function referencedAttachmentNames(content: string): Set<string> {
    const names = new Set<string>();
    const urls = [
        ...Array.from(content.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi), match => match[1]),
        ...Array.from(content.matchAll(/\[[^\]\r\n]*\]\(([^\r\n]+)\)/g), match => match[1]),
    ];
    for (const value of urls) {
        try {
            const url = new URL(value, 'https://stored.invalid');
            if (!url.pathname.startsWith('/uploads/attachments/')) continue;
            let name = url.pathname.slice('/uploads/attachments/'.length);
            name = decodeURIComponent(name.replace(/%(?![\da-f]{2})/gi, '%25'));
            if (name && name !== '.' && name !== '..' && !/[\\/\x00-\x1f\x7f]/.test(name)) names.add(name); // eslint-disable-line no-control-regex
        } catch { /* Invalid stored reference is not a file grant. */ }
    }
    return names;
}

const imageTypes: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };

/** Private files are only readable through a message belonging to the selected account. */
export const inboxAttachmentRoutes: FastifyPluginAsync = async app => {
    app.addHook('preHandler', requireAuthFastify);
    app.get<{ Params: { messageId: string; filename: string } }>('/messages/:messageId/attachments/:filename', async (request, reply) => {
        reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff');
        if (!request.accountId || !request.user?.id) return reply.code(401).send({ error: 'Account context required' });
        if (!await PermissionService.hasPermission(request.user.id, request.accountId, 'view_inbox')) return reply.code(403).send({ error: 'Inbox read access required' });
        const { messageId, filename } = request.params;
        if (!filename || filename === '.' || filename === '..' || /[\\/\x00-\x1f\x7f]/.test(filename)) return reply.code(404).send(); // eslint-disable-line no-control-regex
        const message = await prisma.message.findFirst({
            where: { id: messageId, conversation: { accountId: request.accountId } }, select: { content: true },
        });
        if (!message || !referencedAttachmentNames(message.content).has(filename)) return reply.code(404).send();
        try {
            const root = await realpath(path.join(getUploadsDir(), 'attachments'));
            const file = await realpath(path.join(root, filename));
            if (file !== path.join(root, filename)) return reply.code(404).send();
            const handle = await open(file, 'r');
            const stat = await handle.stat();
            if (!stat.isFile()) { await handle.close(); return reply.code(404).send(); }
            const type = imageTypes[path.extname(filename).toLowerCase()];
            reply.type(type || 'application/octet-stream');
            // SVG/HTML and other active formats must only be downloaded, never rendered inline.
            reply.header('Content-Disposition', `${type ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)}`);
            return reply.send(handle.createReadStream());
        } catch (error) {
            if (['ENOENT', 'ENOTDIR', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) return reply.code(404).send();
            throw error;
        }
    });
};
