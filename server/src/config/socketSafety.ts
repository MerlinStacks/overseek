import type { Socket } from 'socket.io';
import { ZodError } from 'zod';
import { Logger } from '../utils/logger';

export class SocketForbiddenError extends Error {
    constructor() {
        super('Forbidden');
    }
}

/** Socket.IO does not await listeners. Keep both execution and error reporting contained. */
export function safeSocketCallback<Args extends unknown[]>(
    socket: Socket,
    event: string,
    handler: (...args: Args) => unknown,
    lifecycle = false
): (...args: Args) => Promise<void> {
    return async (...args) => {
        const last = args[args.length - 1];
        const ack = !lifecycle && typeof last === 'function' ? last : undefined;
        let response: unknown;
        try {
            await handler(...args);
            response = { ok: true };
        } catch (error) {
            const code = error instanceof ZodError ? 'INVALID_PAYLOAD'
                : error instanceof SocketForbiddenError ? 'FORBIDDEN' : 'INTERNAL_ERROR';
            const message = code === 'INVALID_PAYLOAD' ? 'Invalid payload'
                : code === 'FORBIDDEN' ? 'Forbidden' : 'Internal Server Error';
            response = { ok: false, error: { code, message, event } };
            try {
                const context = { event, socketId: socket.id, userId: socket.data.userId,
                    accountId: socket.data.requestedAccountId, code, error };
                if (code === 'INTERNAL_ERROR') Logger.error('[Socket] Handler failed', context);
                else Logger.warn('[Socket] Handler rejected', context);
            } catch { /* Logging must not turn a handled failure into an unhandled rejection. */ }
            try {
                if (!lifecycle) {
                    if (code === 'FORBIDDEN') socket.emit('auth:error', { message: 'Forbidden' });
                    else if (!ack) socket.emit('socket:error', { code, message, event });
                }
            } catch { /* The transport may already be closed. */ }
        }
        try {
            if (ack) await ack(response);
        } catch { /* A failing acknowledgement must not escape or be invoked twice. */ }
    };
}
