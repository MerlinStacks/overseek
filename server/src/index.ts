import dotenv from 'dotenv';
// Silence dotenv v17+ stdout output to prevent corrupting Pino's JSON log stream
dotenv.config({ quiet: true });

import { appPromise, app } from './app';
import { SchedulerService } from './services/scheduler';
import { startWorkers } from './workers';
import { IndexingService } from './services/search/IndexingService';
import { esClient } from './utils/elastic';
import { Logger } from './utils/logger';
import { validateEnvironment } from './utils/env';
import { initGracefulShutdown } from './utils/shutdown';

// Validate environment variables before proceeding
try {
  validateEnvironment();
} catch (error) {
  Logger.error('[STARTUP] Environment validation failed, exiting');
  process.exit(1);
}

const port = process.env.PORT || 3000;

// Global Error Handlers to prevent silent crashes
process.on('uncaughtException', (error) => {
  Logger.error('[CRITICAL] Uncaught Exception', { error });
});

process.on('unhandledRejection', (reason, promise) => {
  Logger.error('[CRITICAL] Unhandled Rejection', { reason, promise: String(promise) });
});

// Main startup function
async function start() {
  // Wait for Fastify app to be fully initialized
  await appPromise;

  // Start Internal Workers
  try {
    await startWorkers();
    Logger.info('[Startup] Workers initialized');
  } catch (error) {
    Logger.error('[Startup] Failed to start workers', { error });
  }

  // Start Scheduler
  try {
    await SchedulerService.start();
    Logger.info('[Startup] Scheduler started');
  } catch (error) {
    Logger.error('[Startup] Failed to start scheduler', { error });
  }

  // Initialize Elastic Indices
  try {
    await IndexingService.initializeIndices();
    Logger.info('[Startup] Elasticsearch indices initialized');

    // Check if products index is empty (e.g. after mapping reset) and trigger sync
    try {
      const { count } = await esClient.count({ index: 'products' });
      if (count === 0) {
        Logger.info('[Startup] Products index is empty. Triggering initial sync...');
        const { SyncService } = await import('./services/sync');
        const syncService = new SyncService();
        const { prisma } = await import('./utils/prisma');
        const account = await prisma.account.findFirst();
        if (account) {
          // Run in background so server startup isn't blocked too long
          syncService.runSync(account.id, { types: ['products'], incremental: false })
            .catch(err => Logger.error('[Startup] Failed to trigger initial sync', { error: err }));
        }
      }
    } catch (err) {
      Logger.warn('[Startup] Failed to check product index count', { error: err });
    }

  } catch (error) {
    Logger.error('[Startup] Failed to initialize Elasticsearch indices', { error });
  }

  // Start Fastify server
  try {
    await app.listen({ port: Number(port), host: '0.0.0.0' });
    Logger.info(`[Server] Fastify listening on http://0.0.0.0:${port}`);

    // Initialize graceful shutdown after server starts
    initGracefulShutdown(app.server);
  } catch (error) {
    Logger.error('[CRITICAL] Failed to start server', { error });
    process.exit(1);
  }
}

start();
