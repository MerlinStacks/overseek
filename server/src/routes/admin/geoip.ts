import { type FastifyPluginAsync } from 'fastify';
import { requireAuthFastify, requireSuperAdminFastify } from '../../middleware/auth';
import { getDatabaseStatus, installManualGeoIP, updateGeoLiteDB } from '../../services/tracking/GeoIPService';

export const geoipRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', requireSuperAdminFastify);
    fastify.get('/geoip-status', async (_request, reply) => {
        try {
            return { databases: getDatabaseStatus().map(db => ({ source: db.source, installed: db.size > 0, size: db.size, sizeFormatted: `${(db.size / 1024 / 1024).toFixed(1)} MB`, buildDate: Number.isFinite(db.buildDate.getTime()) ? db.buildDate.toISOString() : null, type: db.dbType })) };
        } catch { return reply.code(500).send({ error: 'Failed to check GeoIP status' }); }
    });
    fastify.post('/geoip-force-update', async (_request, reply) => {
        try { return await updateGeoLiteDB() ? { success: true, message: 'GeoIP database updated successfully' } : reply.code(409).send({ error: 'Update unavailable or already in progress. Existing database retained.' }); }
        catch { return reply.code(500).send({ error: 'Failed to update GeoIP database' }); }
    });
    fastify.post('/upload-geoip-db', async (request, reply) => {
        try {
            const data = await request.file({ limits: { files: 1, fileSize: 128 * 1024 * 1024 } });
            if (!data) return reply.code(400).send({ error: 'No file uploaded' });
            if (!data.filename.toLowerCase().endsWith('.mmdb')) { data.file.resume(); return reply.code(400).send({ error: 'Only .mmdb files are accepted' }); }
            const stats = await installManualGeoIP(data.file, () => data.file.truncated);
            return { success: true, message: 'GeoIP database validated, installed and loaded', stats: { ...stats, sizeFormatted: `${(stats.size / 1024 / 1024).toFixed(1)} MB` } };
        } catch (error: unknown) {
            const code = (error as { statusCode?: number })?.statusCode;
            return reply.code(code === 409 ? 409 : code === 413 ? 413 : 400).send({ error: code === 409 ? 'GeoIP update already in progress' : 'GeoIP upload could not be installed. The active database was retained.' });
        }
    });
};
