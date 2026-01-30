/**
 * Graceful Shutdown Handler
 * 
 * Manages clean shutdown of all connections on SIGTERM/SIGINT.
 * Ensures database, Redis, and HTTP connections are properly closed.
 */

import { Server } from 'http';
import { Logger } from './logger';
import { prisma } from './prisma';
import { redisClient } from './redis';
import { SCHEDULER_LIMITS } from '../config/limits';

type ShutdownCallback = () => Promise<void>;

const shutdownCallbacks: ShutdownCallback[] = [];

/**
 * Register a callback to run during shutdown.
 * Use this to drain queues, close connections, etc.
 */
export function onShutdown(callback: ShutdownCallback): void {
    shutdownCallbacks.push(callback);
}

/**
 * Initialize graceful shutdown handlers.
 * Call this once after server starts.
 */
export function initGracefulShutdown(server: Server): void {
    let isShuttingDown = false;

    const shutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;

        Logger.info(`[Shutdown] Received ${signal}, starting graceful shutdown...`);

        // Set a hard timeout to force exit if shutdown takes too long
        const forceExitTimeout = setTimeout(() => {
            Logger.warn('[Shutdown] Forced exit due to timeout');
            process.exit(1);
        }, SCHEDULER_LIMITS.SHUTDOWN_TIMEOUT_MS);

        // Stop accepting new connections
        server.close(() => {
            Logger.info('[Shutdown] HTTP server closed');
        });

        // Run all registered callbacks (e.g., queue draining)
        for (const callback of shutdownCallbacks) {
            try {
                await callback();
            } catch (error) {
                Logger.error('[Shutdown] Callback error', { error });
            }
        }

        // Close Prisma connection
        try {
            await prisma.$disconnect();
            Logger.info('[Shutdown] Database connection closed');
        } catch (error) {
            Logger.error('[Shutdown] Failed to close database', { error });
        }

        // Close Redis connection
        try {
            await redisClient.quit();
            Logger.info('[Shutdown] Redis connection closed');
        } catch (error) {
            Logger.error('[Shutdown] Failed to close Redis', { error });
        }

        clearTimeout(forceExitTimeout);
        Logger.info('[Shutdown] Graceful shutdown complete');
        process.exit(0);
    };

    // Register signal handlers
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    Logger.info('[Shutdown] Graceful shutdown handlers registered');
}

