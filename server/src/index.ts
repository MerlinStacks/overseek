import dotenv from 'dotenv';
// Silence dotenv v17+ stdout output to prevent corrupting Pino's JSON log stream
dotenv.config({ quiet: true });

import os from 'os';

import { appPromise, fastify } from './app';
import { SchedulerService } from './services/scheduler';
import { startWorkers } from './workers';
import { IndexingService } from './services/search/IndexingService';
import { Logger } from './utils/logger';
import { validateEnvironment } from './utils/env';
import { initGracefulShutdown, onShutdown } from './utils/shutdown';
import { startMemoryMonitor, stopMemoryMonitor } from './utils/memoryMonitor';

// Validate environment variables before proceeding
try {
  validateEnvironment();
} catch (error) {
  Logger.error('[STARTUP] Environment validation failed, exiting');
  process.exit(1);
}

const port = process.env.PORT || 3000;

/** Detect the first non-internal IPv4 address for the startup banner */
function getNetworkAddress(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

// Global Error Handlers to prevent silent crashes
process.on('uncaughtException', (error) => {
  Logger.error('[CRITICAL] Uncaught Exception', { error });
  process.exit(1);
});

process.on('unhandledRejection', (reason, _promise) => {
  // Serialize the reason properly - PrismaClientValidationError and other errors
  // have non-enumerable properties that need explicit extraction
  const serializedReason = reason instanceof Error
    ? { name: reason.name, message: reason.message, stack: reason.stack }
    : reason;
  Logger.error('[CRITICAL] Unhandled Rejection', { reason: serializedReason });
  process.exit(1);
});

// Main startup function
async function start() {
  // Wait for Fastify app to be fully initialized
  await appPromise;

  // Start lightweight memory telemetry early in bootstrap.
  startMemoryMonitor();
  onShutdown(async () => {
    stopMemoryMonitor();
  });

  const { WebhookDeliveryService } = await import('./services/WebhookDeliveryService');
  WebhookDeliveryService.startCleanupSchedule();
  onShutdown(async () => {
    WebhookDeliveryService.stopCleanupSchedule();
  });

  // Start Internal Workers
  try {
    await startWorkers();
    Logger.info('[Startup] Workers initialized');

    const { stopWorkers } = await import('./workers');
    onShutdown(() => stopWorkers());
  } catch (error) {
    Logger.error('[Startup] Failed to start workers', { error });
  }

  // Start Scheduler
  try {
    await SchedulerService.start();
    Logger.info('[Startup] Scheduler started');

    onShutdown(() => SchedulerService.shutdown());
  } catch (error) {
    Logger.error('[Startup] Failed to start scheduler', { error });
  }

  // Start keyword rank tracking scheduler
  try {
    const { startKeywordRankScheduler, stopKeywordRankScheduler } = await import('./services/search-console/keywordRankScheduler');
    startKeywordRankScheduler();
    onShutdown(async () => {
      stopKeywordRankScheduler();
    });
    Logger.info('[Startup] Keyword rank scheduler started');
  } catch (error) {
    Logger.error('[Startup] Failed to start keyword rank scheduler', { error });
  }

  // Start competitor SERP position tracking scheduler
  try {
    const { startCompetitorRankScheduler, stopCompetitorRankScheduler } = await import('./services/search-console/CompetitorRankScheduler');
    startCompetitorRankScheduler();
    onShutdown(async () => {
      stopCompetitorRankScheduler();
    });
    Logger.info('[Startup] Competitor rank scheduler started');
  } catch (error) {
    Logger.error('[Startup] Failed to start competitor rank scheduler', { error });
  }

  // Initialize Elastic Indices
  try {
    await IndexingService.initializeIndices();
    Logger.info('[Startup] Elasticsearch indices initialized');

    // Run in the background so large multi-account index repairs do not delay
    // API startup. The migration is versioned in Elasticsearch index metadata.
    IndexingService.ensureProductDocumentIds()
      .catch(err => Logger.error('[Startup] Failed to repair product document IDs', { error: err }));

  } catch (error) {
    Logger.error('[Startup] Failed to initialize Elasticsearch indices', { error });
  }

  // Start Fastify server
  try {
    await fastify.listen({ port: Number(port), host: '0.0.0.0' });
    Logger.info(`[Server] Fastify listening on http://0.0.0.0:${port}`);

    // Print human-readable startup banner to console
    const networkAddress = getNetworkAddress();
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║           OverSeek API Server Ready          ║');
    console.log('  ╠══════════════════════════════════════════════╣');
    console.log(`  ║  Local:    http://localhost:${port}             ║`);
    if (networkAddress) {
      console.log(`  ║  Network:  http://${networkAddress}:${port}`.padEnd(49) + '║');
    }
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');

    // Initialize graceful shutdown after server starts
    initGracefulShutdown(fastify.server);
  } catch (error) {
    Logger.error('[CRITICAL] Failed to start server', { error });
    process.exit(1);
  }
}

start();
