/**
 * Health Check Route - Fastify Plugin
 * 
 * Provides health and readiness endpoints for monitoring.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { esClient } from '../utils/elastic';
import { Logger } from '../utils/logger';
import { getLatestMemorySnapshot } from '../utils/memoryMonitor';
import { QueueFactory } from '../services/queue/QueueFactory';

interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    uptime: number;
    version: string;
    checks: {
        database: boolean;
        redis: boolean;
        elasticsearch: boolean;
    };
    runtime?: {
        memory: {
            heapUsedPct: number;
            rssMb: number;
            eventLoopLagP95Ms: number;
            eventLoopLagMeanMs: number;
            eventLoopLagMaxMs: number;
        };
        queues: Record<string, {
            waiting: number;
            active: number;
            delayed: number;
            failed: number;
            completed: number;
            paused: number;
            prioritized: number;
            backlog: number;
        }>;
    };
}

const healthRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /health
     * Basic health check - returns 200 if server is running.
     */
    fastify.get('/', async (request, reply) => {
        return {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        };
    });

    /**
     * GET /health/ready
     * Readiness check - verifies all dependencies are connected.
     */
    fastify.get('/ready', async (request, reply) => {
        const checks = {
            database: false,
            redis: false,
            elasticsearch: false
        };

        // Check database
        try {
            await prisma.$queryRaw`SELECT 1`;
            checks.database = true;
        } catch (error) {
            Logger.warn('[Health] Database check failed', { error });
        }

        // Check Redis
        try {
            await redisClient.ping();
            checks.redis = true;
        } catch (error) {
            Logger.warn('[Health] Redis check failed', { error });
        }

        // Check Elasticsearch
        try {
            const esHealth = await esClient.cluster.health();
            checks.elasticsearch = esHealth.status !== 'red';
        } catch (error) {
            Logger.warn('[Health] Elasticsearch check failed', { error });
        }

        const healthyCount = Object.values(checks).filter(Boolean).length;
        const allHealthy = healthyCount === 3;
        const allDown = healthyCount === 0;

        // Determine overall status
        let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
        if (allHealthy) {
            overallStatus = 'healthy';
        } else if (allDown) {
            overallStatus = 'unhealthy';
        } else {
            overallStatus = 'degraded';
        }

        const status: HealthStatus = {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: process.env.npm_package_version || '1.0.0',
            checks
        };

        try {
            const memory = getLatestMemorySnapshot();
            const queues = await QueueFactory.getQueueDepthSnapshot();
            status.runtime = {
                memory: {
                    heapUsedPct: memory.heapUsedPct,
                    rssMb: memory.rssMb,
                    eventLoopLagP95Ms: memory.eventLoopLagP95Ms,
                    eventLoopLagMeanMs: memory.eventLoopLagMeanMs,
                    eventLoopLagMaxMs: memory.eventLoopLagMaxMs,
                },
                queues
            };
        } catch (error) {
            Logger.warn('[Health] Runtime telemetry collection failed', { error });
        }

        // Return 200 for healthy/degraded, 503 only if ALL services are down
        // This allows the container to be marked healthy even if ES is still starting
        return reply.code(allDown ? 503 : 200).send(status);
    });

    /**
     * GET /health/live
     * Liveness check - simple ping for container orchestrators.
     */
    fastify.get('/live', async (request, reply) => {
        return reply.code(200).send('OK');
    });

    /**
     * GET /health/version
     * App version check for PWA update detection.
     * Returns current server version and optional update metadata.
     */
    fastify.get('/version', async (_request, _reply) => {
        // Build version - auto-generated at build time or from environment
        const version = process.env.APP_VERSION || new Date().toISOString().split('T')[0].replace(/-/g, '.');

        return {
            version,
            // Optional: Add release notes or feature highlights
            message: 'Latest improvements and bug fixes',
            features: [
                'Performance improvements',
                'Bug fixes and stability'
            ]
        };
    });

    /**
     * GET /health/memory
     * Returns latest process memory snapshot for operational monitoring.
     */
    fastify.get('/memory', async (_request, _reply) => {
        const snapshot = getLatestMemorySnapshot();
        return {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: snapshot
        };
    });
};

export default healthRoutes;
