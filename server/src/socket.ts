/**
 * Socket.IO singleton for access throughout the application.
 * Used by services that need to emit events to connected clients.
 */

import { Server } from 'socket.io';

let io: Server | null = null;

/**
 * Set the Socket.IO server instance.
 * Called during app initialization.
 */
export function setIO(ioInstance: Server) {
    io = ioInstance;
}

/**
 * Get the Socket.IO server instance.
 * Returns null if not initialized yet.
 */
export function getIO(): Server | null {
    return io;
}
