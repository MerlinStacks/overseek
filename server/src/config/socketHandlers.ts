/**
 * Socket.IO Event Handlers
 * 
 * Socket connection handlers for real-time features.
 * Extracted from app.ts for maintainability.
 */

import { Server, Socket } from 'socket.io';
import { prisma } from '../utils/prisma';
const { Logger } = require('../utils/logger');

/**
 * Registers all Socket.IO event handlers
 */
export function setupSocketHandlers(io: Server): void {
    io.on('connection', (socket: Socket) => {
        // Account room join
        socket.on('join:account', (accountId) => {
            if (!accountId) return;
            if (!socket.data.isSuperAdmin && !socket.data.accountIds?.includes(accountId)) {
                Logger.warn('[Socket] Unauthorized account join attempt', { accountId, socketId: socket.id });
                socket.emit('auth:error', { message: 'Forbidden' });
                return;
            }
            Logger.warn(`[Socket] Client joined account room: account:${accountId}`, { socketId: socket.id });
            socket.join(`account:${accountId}`);
        });

        // Conversation presence tracking
        socket.on('join:conversation', async (payload) => {
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
                    socket.emit('auth:error', { message: 'Forbidden' });
                    return;
                }
            }

            socket.join(`conversation:${conversationId}`);

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

        socket.on('leave:conversation', async ({ conversationId }) => {
            socket.leave(`conversation:${conversationId}`);
            if (conversationId) {
                const { CollaborationService } = await import('../services/CollaborationService');
                await CollaborationService.leaveDocument(`conv:${conversationId}`, socket.id);
                const viewers = await CollaborationService.getPresence(`conv:${conversationId}`);
                io.to(`conversation:${conversationId}`).emit('viewers:sync', viewers);
            }
        });

        // Typing indicators
        socket.on('typing:start', ({ conversationId }) => {
            socket.to(`conversation:${conversationId}`).emit('typing:start', { conversationId });
        });

        socket.on('typing:stop', ({ conversationId }) => {
            socket.to(`conversation:${conversationId}`).emit('typing:stop', { conversationId });
        });

        // Document presence (Invoice Designer, etc.)
        socket.on('join:document', async ({ docId, user }) => {
            socket.join(`document:${docId}`);
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

        socket.on('leave:document', async ({ docId }) => {
            socket.leave(`document:${docId}`);
            const { CollaborationService } = await import('../services/CollaborationService');
            await CollaborationService.leaveDocument(docId, socket.id);
            const presenceList = await CollaborationService.getPresence(docId);
            io.to(`document:${docId}`).emit('presence:sync', presenceList);
        });

        // Heartbeat for presence
        socket.on('presence:heartbeat', async ({ docId }) => {
            if (!docId) return;
            const { CollaborationService } = await import('../services/CollaborationService');
            await CollaborationService.refreshPresence(docId, socket.id);
        });

        // Cleanup on disconnect
        socket.on('disconnecting', async () => {
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
        });
    });
}
