import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import retiredWholesaleCatalogRoutes from './retiredWholesaleCatalog';

describe('retired wholesale catalog compatibility', () => {
    it('returns a generic 410 for old management and protected viewer URLs without dependencies', async () => {
        const app = Fastify();
        await app.register(retiredWholesaleCatalogRoutes, { prefix: '/api' });
        try {
            for (const url of [
                '/api/wholesale-catalog', '/api/wholesale-catalog/',
                '/api/wholesale-catalog/branding', '/api/wholesale-catalog/catalogs/legacy/generate',
                '/api/wholesale-catalog/generations/legacy/download',
                '/api/catalog-view', '/api/catalog-view/',
                '/api/catalog-view/secret-token/pages/1', '/api/catalog-view/secret-token/unlock',
            ]) {
                for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
                    const response = await app.inject({ method, url, headers: { cookie: 'catalog_session=legacy' } });
                    expect(response.statusCode, `${method} ${url}`).toBe(410);
                    expect(response.headers['cache-control']).toBe('no-store');
                    expect(response.json()).toEqual({ code: 'FEATURE_RETIRED', error: 'Wholesale catalogs are no longer available.' });
                    expect(response.body).not.toContain('secret-token');
                }
            }
            expect((await app.inject('/api/wholesale-catalogue')).statusCode).toBe(404);
        } finally {
            await app.close();
        }
    });
});
