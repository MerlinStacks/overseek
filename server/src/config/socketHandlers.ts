/**
 * Socket.IO Event Handlers
 * 
 * Socket connection handlers for real-time features.
 * Extracted from app.ts for maintainability.
 */

import { Server, Socket } from 'socket.io';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import * as z from 'zod';
import { safeSocketCallback, SocketForbiddenError } from './socketSafety';

const id = z.string().refine(value => value.trim().length > 0);
const userSchema = z.object({
    id: z.string().nullish(),
    name: z.string().nullish(),
    avatarUrl: z.string().nullish(),
    color: z.string().optional()
});
const conversationPayload = z.object({ conversationId: id });
const documentPayload = z.object({ docId: id });

/**
 * Registers all Socket.IO event handlers
 */
export function setupSocketHandlers(io: Server): void {
    io.on('connection', (socket: Socket) => {
        const on = <T extends z.ZodType>(event: string, schema: T, handler: (payload: z.output<T>) => unknown) => {
            socket.on(event, safeSocketCallback(socket, event, (payload: unknown, ..._args: unknown[]) =>
                handler(schema.parse(payload))));
        };
        const requestedAccountId = socket.data.requestedAccountId;
        if (requestedAccountId) {
            void safeSocketCallback(socket, 'connection', async () => {
                await socket.join(`account:${id.parse(requestedAccountId)}`);
                Logger.debug(`[Socket] Client auto-joined account room: account:${requestedAccountId}`, { socketId: socket.id });
            }, true)();
        }

        // Account room join
        on('join:account', id, async (accountId) => {
            if (!socket.data.isSuperAdmin && !socket.data.accountIds?.includes(accountId)) {
                Logger.warn('[Socket] Unauthorized account join attempt', { accountId, socketId: socket.id });
                throw new SocketForbiddenError();
            }
            Logger.debug(`[Socket] Client joined account room: account:${accountId}`, { socketId: socket.id });
            await socket.join(`account:${accountId}`);
        });

        // Conversation presence tracking
        on('join:conversation', z.union([id, conversationPayload.extend({ user: userSchema.nullish() })]), async (payload) => {
            const { conversationId, user } = typeof payload === 'string'
                ? { conversationId: payload, user: undefined }
                : (payload || {});

            if (!conversationId) return;

            if (!socket.data.isSuperAdmin) {
                const conversation = await prisma.conversation.findUnique({
                    where: { id: conversationId },
                    select: { accountId: true }
                });

                if (!conversation || !socket.data.accountIds?.includes(conversation.accountId)) {
                    Logger.warn('[Socket] Unauthorized conversation join attempt', { conversationId, socketId: socket.id });
                    throw new SocketForbiddenError();
                }
            }

            await socket.join(`conversation:${conversationId}`);

            if (user && conversationId) {
                const userInfo = {
                    userId: user.id || 'anon',
                    name: user.name || 'Anonymous',
                    avatarUrl: user.avatarUrl,
                    connectedAt: Date.now()
                };
                const { CollaborationService } = await import('../services/CollaborationService');
                await CollaborationService.joinDocument(`conv:${conversationId}`, socket.id, userInfo);
                const viewers = await CollaborationService.getPresence(`conv:${conversationId}`);
                io.to(`conversation:${conversationId}`).emit('viewers:sync', viewers);
            }
        });

        on('leave:conversation', conversationPayload, async ({ conversationId }) => {
            await socket.leave(`conversation:${conversationId}`);
            if (conversationId) {
                const { CollaborationService } = await import('../services/CollaborationService');
                await CollaborationService.leaveDocument(`conv:${conversationId}`, socket.id);
                const viewers = await CollaborationService.getPresence(`conv:${conversationId}`);
                io.to(`conversation:${conversationId}`).emit('viewers:sync', viewers);
            }
        });

        // Typing indicators
        on('typing:start', conversationPayload, ({ conversationId }) => {
            socket.to(`conversation:${conversationId}`).emit('typing:start', { conversationId });
        });

        on('typing:stop', conversationPayload, ({ conversationId }) => {
            socket.to(`conversation:${conversationId}`).emit('typing:stop', { conversationId });
        });

        // Agent draft presence (collision-avoidance while composing replies)
        on('agent:draft:start', conversationPayload.extend({ user: userSchema.extend({ id }) }), ({ conversationId, user }) => {
            if (!conversationId || !user?.id) return;
            socket.to(`conversation:${conversationId}`).emit('agent:draft:start', {
                conversationId,
                user: {
                    id: user.id,
                    name: user.name || 'Agent',
                    avatarUrl: user.avatarUrl || null
                },
                startedAt: Date.now()
            });
        });

        on('agent:draft:stop', conversationPayload.extend({ userId: id }), ({ conversationId, userId }) => {
            if (!conversationId || !userId) return;
            socket.to(`conversation:${conversationId}`).emit('agent:draft:stop', {
                conversationId,
                userId
            });
        });

        // Document presence (Invoice Designer, etc.)
        on('join:document', documentPayload.extend({ user: userSchema }), async ({ docId, user }) => {
            await socket.join(`document:${docId}`);
            const userInfo = {
                userId: user.id || 'anon',
                name: user.name || 'Anonymous',
                avatarUrl: user.avatarUrl,
                color: user.color,
                connectedAt: Date.now()
            };

            const { CollaborationService } = await import('../services/CollaborationService');
            await CollaborationService.joinDocument(docId, socket.id, userInfo);
            const presenceList = await CollaborationService.getPresence(docId);
            io.to(`document:${docId}`).emit('presence:sync', presenceList);
        });

        on('leave:document', documentPayload, async ({ docId }) => {
            await socket.leave(`document:${docId}`);
            const { CollaborationService } = await import('../services/CollaborationService');
            await CollaborationService.leaveDocument(docId, socket.id);
            const presenceList = await CollaborationService.getPresence(docId);
            io.to(`document:${docId}`).emit('presence:sync', presenceList);
        });

        // Heartbeat for presence
        on('presence:heartbeat', documentPayload, async ({ docId }) => {
            if (!docId) return;
            const { CollaborationService } = await import('../services/CollaborationService');
            await CollaborationService.refreshPresence(docId, socket.id);
        });

        // Cleanup on disconnect
        socket.on('disconnecting', safeSocketCallback(socket, 'disconnecting', async () => {
            const rooms: string[] = Array.from(socket.rooms) as string[];
            const { CollaborationService } = await import('../services/CollaborationService');

            // Clean up conversation presence
            const convRooms = rooms.filter((r: string) => r.startsWith('conversation:'));
            for (const room of convRooms) {
                const conversationId = room.replace('conversation:', '');
                await CollaborationService.leaveDocument(`conv:${conversationId}`, socket.id);
                const viewers = await CollaborationService.getPresence(`conv:${conversationId}`);
                io.to(room).emit('viewers:sync', viewers);
            }

            // Clean up document presence
            const docRooms = rooms.filter((r: string) => r.startsWith('document:'));
            for (const room of docRooms) {
                const docId = room.replace('document:', '');
                await CollaborationService.leaveDocument(docId, socket.id);
                const presenceList = await CollaborationService.getPresence(docId);
                io.to(room).emit('presence:sync', presenceList);
            }
        }, true));
    });
}
