

import { Server } from 'http';
import { Logger } from './logger';
import { prisma } from './prisma';
import { redisClient } from './redis';
import { SCHEDULER_LIMITS } from '../config/limits';

type ShutdownCallback = () => Promise<void>;

const shutdownCallbacks: ShutdownCallback[] = [];
const resourceCallbacks: ShutdownCallback[] = [];

/** register a callback to run on shutdown (queue draining, etc.) */
export function onShutdown(callback: ShutdownCallback, phase: 'drain' | 'resources' = 'drain'): void {
    (phase === 'resources' ? resourceCallbacks : shutdownCallbacks).push(callback);
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


        let failed = false;
        const httpClosed = new Promise<void>(resolve => {
            try {
                server.close(error => {
                    if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
                        failed = true;
                        Logger.error('[Shutdown] HTTP close failed', { error });
                    }
                    Logger.info('[Shutdown] HTTP server closed');
                    resolve();
                });
            } catch (error) {
                failed = true;
                Logger.error('[Shutdown] HTTP close failed', { error });
                resolve();
            }
        });


        for (const callback of shutdownCallbacks) {
            try {
                await callback();
            } catch (error) {
                failed = true;
                Logger.error('[Shutdown] Callback error', { error });
            }
        }
        // Keep shared dependencies alive for in-flight requests and queue draining.
        await httpClosed;
        for (const callback of resourceCallbacks) {
            try { await callback(); } catch (error) { failed = true; Logger.error('[Shutdown] Resource cleanup failed', { error }); }
        }


        try {
            await prisma.$disconnect();
            Logger.info('[Shutdown] Database connection closed');
        } catch (error) {
            failed = true;
            Logger.error('[Shutdown] Failed to close database', { error });
        }


        try {
            await redisClient.quit();
            Logger.info('[Shutdown] Redis connection closed');
        } catch (error) {
            failed = true;
            Logger.error('[Shutdown] Failed to close Redis', { error });
        }

        clearTimeout(forceExitTimeout);
        Logger.info('[Shutdown] Graceful shutdown complete');
        process.exit(failed ? 1 : 0);
    };


    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    Logger.info('[Shutdown] Graceful shutdown handlers registered');
}
