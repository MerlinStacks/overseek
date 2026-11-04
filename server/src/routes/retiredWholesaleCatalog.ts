import type { FastifyPluginAsync } from 'fastify';

/** Compatibility tombstones: never read legacy data or expose private artifacts. */
const retiredWholesaleCatalogRoutes: FastifyPluginAsync = async fastify => {
    for (const path of ['/wholesale-catalog', '/catalog-view']) {
        for (const url of [path, `${path}/*`]) {
            fastify.all(url, async (_request, reply) => reply
                .header('Cache-Control', 'no-store')
                .code(410)
                .send({ code: 'FEATURE_RETIRED', error: 'Wholesale catalogs are no longer available.' }));
        }
    }
};

export default retiredWholesaleCatalogRoutes;
