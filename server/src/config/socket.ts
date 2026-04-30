import http from 'http';
import { Server } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { verifyToken } from '../utils/auth';
import { setIO } from '../socket';
import { ChatService } from '../services/ChatService';

interface SocketInitResult {
    io: Server;
    chatService: ChatService;
}

export async function initializeSocketIO(server: http.Server, fastify: FastifyInstance): Promise<SocketInitResult> {
    const socketOrigins = process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
        : (process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : []);
    const socketOriginSetting = socketOrigins.length > 0 ? socketOrigins : '*';

    const io = new Server(server, {
        cors: { origin: socketOriginSetting, methods: ['GET', 'POST'] }
    });

    // Socket.IO auth middleware
    io.use(async (socket, next) => {
        try {
            const authHeader = socket.handshake.headers?.authorization as string | undefined;
            const token =
                socket.handshake.auth?.token ||
                (authHeader ? authHeader.split(' ')[1] : undefined) ||
                (socket.handshake.query?.token as string | undefined);

            if (!token) return next(new Error('Unauthorized'));

            const decoded = verifyToken(token) as { userId: string };

            try {
                const user = await prisma.user.findUnique({
                    where: { id: decoded.userId },
                    select: { isSuperAdmin: true }
                });
                const memberships = await prisma.accountUser.findMany({
                    where: { userId: decoded.userId },
                    select: { accountId: true }
                });

                socket.data.userId = decoded.userId;
                socket.data.isSuperAdmin = user?.isSuperAdmin === true;
                socket.data.accountIds = memberships.map(m => m.accountId);

                return next();
            } catch (dbError) {
                Logger.error('[Socket.IO] Database error during auth', { error: dbError });
                return next(new Error('Internal Server Error'));
            }
        } catch (error) {
            const isExpired = error instanceof Error && error.name === 'TokenExpiredError';
            if (isExpired) {
                Logger.debug('[Socket.IO] Token expired on socket auth', { socketId: socket.id });
            } else {
                Logger.warn('[Socket.IO] Auth failed', { error });
            }
            return next(new Error('Unauthorized'));
        }
    });

    // Apply Redis adapter for horizontal scaling
    try {
        const { createSocketAdapter } = await import('../utils/socketAdapter');
        io.adapter(createSocketAdapter());
        Logger.info('[Socket.IO] Redis adapter enabled for horizontal scaling');
    } catch (error) {
        Logger.warn('[Socket.IO] Redis adapter not available, running in single-instance mode', { error });
    }

    setIO(io);

    const chatService = new ChatService(io);

    // Mount Chat Routes
    const { createChatRoutes } = await import('../routes/chat');
    const { createPublicChatRoutes } = await import('../routes/chat-public');
    const { createSmsRoutes } = await import('../routes/sms');
    await fastify.register(createChatRoutes(chatService), { prefix: '/api/chat' });
    await fastify.register(createPublicChatRoutes(chatService), { prefix: '/api/chat/public' });
    await fastify.register(createSmsRoutes(chatService), { prefix: '/api/sms' });

    return { io, chatService };
}
