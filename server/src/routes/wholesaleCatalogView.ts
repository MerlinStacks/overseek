import { FastifyPluginAsync } from 'fastify';
import z from 'zod';
import { VIEWER_COOKIE, WholesaleViewerService } from '../services/wholesale/viewer';
import { sha256 } from '../services/wholesale/shareSecurity';

const tokenSchema = z.object({ token: z.string().min(32).max(200) });
const pageSchema = tokenSchema.extend({ pageNumber: z.coerce.number().int().min(1) });
const unlockSchema = z.object({ password: z.string().min(1).max(200) }).strict();
const identifySchema = z.object({ name: z.string().trim().min(1).max(150), email: z.email().max(254) }).strict();
const generic = { error: 'Catalog is unavailable or access could not be verified' };
const viewerRateLimit = {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (request: any) => `${request.ip}:${sha256(String(request.params?.token || '').slice(0, 200))}`,
};
const unlockRateLimit = {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (request: any) => `${request.ip}:${sha256(String(request.params?.token || '').slice(0, 200))}:unlock`,
};
const viewerRoute = { config: { rateLimit: viewerRateLimit } };
const unlockRoute = { config: { rateLimit: unlockRateLimit } };

function cookie(value: string, expires: Date) {
    return `${VIEWER_COOKIE}=${encodeURIComponent(value)}; Path=/api/catalog-view; Expires=${expires.toUTCString()}; HttpOnly; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

function secureViewerResponse(reply: any) {
    reply.header('Cache-Control', 'no-store, private').header('X-Robots-Tag', 'noindex, nofollow, noarchive').header('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'none'; sandbox");
}

const wholesaleCatalogViewRoutes: FastifyPluginAsync = async fastify => {
    fastify.get('/:token', viewerRoute, async (request, reply) => {
        const params = tokenSchema.safeParse(request.params); if (!params.success) return reply.code(404).send(generic);
        try { secureViewerResponse(reply); return await WholesaleViewerService.prompt(params.data.token); } catch { return reply.code(404).send(generic); }
    });
    fastify.post('/:token/unlock', unlockRoute, async (request, reply) => {
        const params = tokenSchema.safeParse(request.params); const body = unlockSchema.safeParse(request.body);
        if (!params.success || !body.success) return reply.code(401).send(generic);
        try { const result = await WholesaleViewerService.unlock(params.data.token, body.data.password, request); reply.header('Set-Cookie', cookie(result.rawSession, result.expiresAt)); return { privacyNotice: result.privacyNotice }; } catch { return reply.code(401).send(generic); }
    });
    fastify.post('/:token/identify', viewerRoute, async (request, reply) => {
        const params = tokenSchema.safeParse(request.params); const body = identifySchema.safeParse(request.body);
        if (!params.success || !body.success) return reply.code(400).send(generic);
        try { return await WholesaleViewerService.identify(params.data.token, request, body.data.name, body.data.email); } catch { return reply.code(401).send(generic); }
    });
    fastify.post('/:token/accept', viewerRoute, async (request, reply) => {
        const params = tokenSchema.safeParse(request.params); if (!params.success) return reply.code(401).send(generic);
        try { await WholesaleViewerService.accept(params.data.token, request); return { accepted: true }; } catch { return reply.code(401).send(generic); }
    });
    fastify.get('/:token/pages', viewerRoute, async (request, reply) => {
        const params = tokenSchema.safeParse(request.params); if (!params.success) return reply.code(404).send(generic);
        try { secureViewerResponse(reply); return await WholesaleViewerService.pages(params.data.token, request); } catch { return reply.code(404).send(generic); }
    });
    const image = (thumbnail: boolean) => async (request: any, reply: any) => {
        const params = pageSchema.safeParse(request.params); if (!params.success) return reply.code(404).send(generic);
        try { secureViewerResponse(reply); reply.type('image/svg+xml; charset=utf-8'); return await WholesaleViewerService.page(params.data.token, request, params.data.pageNumber, thumbnail); } catch { return reply.code(404).send(generic); }
    };
    fastify.get('/:token/pages/:pageNumber', viewerRoute, image(false));
    fastify.get('/:token/thumbnails/:pageNumber', viewerRoute, image(true));
    fastify.post('/:token/logout', viewerRoute, async (request, reply) => {
        const params = tokenSchema.safeParse(request.params);
        try { if (params.success) await WholesaleViewerService.logout(params.data.token, request); } catch { /* Logout remains enumeration-safe. */ }
        reply.header('Set-Cookie', `${VIEWER_COOKIE}=; Path=/api/catalog-view; Max-Age=0; HttpOnly; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
        return reply.code(204).send();
    });
};

export default wholesaleCatalogViewRoutes;
