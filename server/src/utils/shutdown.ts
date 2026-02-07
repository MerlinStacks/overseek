

import { Server } from 'http';
import { Logger } from './logger';
import { prisma } from './prisma';
import { redisClient } from './redis';
import { SCHEDULER_LIMITS } from '../config/limits';

type ShutdownCallback = () => Promise<void>;

const shutdownCallbacks: ShutdownCallback[] = [];

/** register a callback to run on shutdown (queue draining, etc.) */
export function onShutdown(callback: ShutdownCallback): void {
    shutdownCallbacks.push(callback);
}


export function initGracefulShutdown(server: Server): void {
    let isShuttingDown = false;

    const shutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;

        Logger.info(`[Shutdown] Received ${signal}, starting graceful shutdown...`);

        // hard timeout in case shutdown hangs
        const forceExitTimeout = setTimeout(() => {
            Logger.warn('[Shutdown] Forced exit due to timeout');
            process.exit(1);
        }, SCHEDULER_LIMITS.SHUTDOWN_TIMEOUT_MS);


        server.close(() => {
            Logger.info('[Shutdown] HTTP server closed');
        });


        for (const callback of shutdownCallbacks) {
            try {
                await callback();
            } catch (error) {
                Logger.error('[Shutdown] Callback error', { error });
            }
        }


        try {
            await prisma.$disconnect();
            Logger.info('[Shutdown] Database connection closed');
        } catch (error) {
            Logger.error('[Shutdown] Failed to close database', { error });
        }


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


    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    Logger.info('[Shutdown] Graceful shutdown handlers registered');
}

