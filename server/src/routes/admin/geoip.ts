/**
 * GeoIP Admin Routes
 * 
 * Handles GeoIP database status and updates.
 * Extracted from admin.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify, requireSuperAdminFastify } from '../../middleware/auth';
import { Logger } from '../../utils/logger';
import { initGeoIP } from '../../services/tracking/GeoIPService';
import path from 'path';
import fs from 'fs';

export const geoipRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', requireSuperAdminFastify);

    // GeoIP Status
    fastify.get('/geoip-status', async (request, reply) => {
        try {
            const { getDatabaseStatus } = await import('../../services/tracking/GeoIPService');
            const databases = getDatabaseStatus();

            return {
                databases: databases.map(db => ({
                    source: db.source,
                    installed: true,
                    size: db.size,
                    sizeFormatted: `${(db.size / 1024 / 1024).toFixed(1)} MB`,
                    buildDate: db.buildDate.toISOString(),
                    type: db.dbType
                }))
            };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to check GeoIP status' });
        }
    });

    // Force GeoIP Update
    fastify.post('/geoip-force-update', async (request, reply) => {
        try {
            const { updateGeoLiteDB } = await import('../../services/tracking/GeoIPService');
            const success = await updateGeoLiteDB();
            if (success) {
                return { success: true, message: 'GeoIP database updated successfully' };
            } else {
                return reply.code(400).send({ error: 'Update failed or already in progress' });
            }
        } catch (e: any) {
            return reply.code(500).send({ error: e.message || 'Failed to update GeoIP database' });
        }
    });

    // GeoIP Upload - using @fastify/multipart 
    fastify.post('/upload-geoip-db', async (request, reply) => {
        try {
            const data = await (request as any).file();
            if (!data) return reply.code(400).send({ error: 'No file uploaded' });

            const filename = data.filename;
            if (!filename.endsWith('.mmdb')) return reply.code(400).send({ error: 'Only .mmdb files are accepted' });

            const dataDir = path.join(__dirname, '../../../data');
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

            const filePath = path.join(dataDir, 'GeoLite2-City.mmdb');
            const writeStream = fs.createWriteStream(filePath);

            for await (const chunk of data.file) {
                writeStream.write(chunk);
            }
            writeStream.end();

            await initGeoIP(true);

            const fileStat = fs.statSync(filePath);
            return {
                success: true,
                message: 'GeoIP database uploaded and loaded successfully',
                stats: { size: fileStat.size, sizeFormatted: `${(fileStat.size / 1024 / 1024).toFixed(1)} MB`, lastModified: fileStat.mtime.toISOString() }
            };
        } catch (e: any) {
            Logger.error('Failed to upload GeoIP database', { error: e });
            return reply.code(500).send({ error: e.message || 'Failed to upload GeoIP database' });
        }
    });
};
