import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';
import { setupMockAccount } from '../../scripts/setupMockAccount';
import { seedMockData } from '../../scripts/seedMockData';
import { resetMockData } from '../../scripts/resetMockData';
import { parseFirstIssueOrReply } from '../routeHelpers';

const seedSchema = z.object({
    productsCount: z.number().int().min(1).max(500).optional(),
    customersCount: z.number().int().min(1).max(500).optional(),
    ordersCount: z.number().int().min(1).max(2000).optional(),
});

type SeedBody = z.infer<typeof seedSchema>;

function applyMockEnvOverrides(overrides: SeedBody): () => void {
    const previousProducts = process.env.MOCK_PRODUCTS_COUNT;
    const previousCustomers = process.env.MOCK_CUSTOMERS_COUNT;
    const previousOrders = process.env.MOCK_ORDERS_COUNT;

    if (overrides.productsCount !== undefined) {
        process.env.MOCK_PRODUCTS_COUNT = String(overrides.productsCount);
    }
    if (overrides.customersCount !== undefined) {
        process.env.MOCK_CUSTOMERS_COUNT = String(overrides.customersCount);
    }
    if (overrides.ordersCount !== undefined) {
        process.env.MOCK_ORDERS_COUNT = String(overrides.ordersCount);
    }

    return () => {
        if (previousProducts === undefined) delete process.env.MOCK_PRODUCTS_COUNT;
        else process.env.MOCK_PRODUCTS_COUNT = previousProducts;

        if (previousCustomers === undefined) delete process.env.MOCK_CUSTOMERS_COUNT;
        else process.env.MOCK_CUSTOMERS_COUNT = previousCustomers;

        if (previousOrders === undefined) delete process.env.MOCK_ORDERS_COUNT;
        else process.env.MOCK_ORDERS_COUNT = previousOrders;
    };
}

function getConfiguredCounts() {
    return {
        productsCount: Number(process.env.MOCK_PRODUCTS_COUNT ?? '12'),
        customersCount: Number(process.env.MOCK_CUSTOMERS_COUNT ?? '8'),
        ordersCount: Number(process.env.MOCK_ORDERS_COUNT ?? '20'),
    };
}

export const mockDataRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get('/mock-data/status', async (_request, reply) => {
        try {
            const setup = await setupMockAccount();
            const [products, customers, orders] = await prisma.$transaction([
                prisma.wooProduct.count({ where: { accountId: setup.accountId } }),
                prisma.wooCustomer.count({ where: { accountId: setup.accountId } }),
                prisma.wooOrder.count({ where: { accountId: setup.accountId } }),
            ]);

            return {
                accountId: setup.accountId,
                loginEmail: setup.email,
                loginPassword: setup.password,
                counts: { products, customers, orders },
                configured: getConfiguredCounts(),
            };
        } catch (error) {
            Logger.error('[Admin] Failed to fetch mock data status', { error });
            return reply.code(500).send({ error: 'Failed to fetch mock data status' });
        }
    });

    fastify.post<{ Body: SeedBody }>('/mock-data/seed', async (request, reply) => {
        try {
            const parsed = parseFirstIssueOrReply<SeedBody>(reply, seedSchema.safeParse(request.body ?? {}));
            if (!parsed) return;

            const restoreEnv = applyMockEnvOverrides(parsed);

            try {
                await seedMockData();
            } finally {
                restoreEnv();
            }

            return { success: true, message: 'Mock data seeded successfully' };
        } catch (error) {
            Logger.error('[Admin] Failed to seed mock data', { error });
            return reply.code(500).send({ error: 'Failed to seed mock data' });
        }
    });

    fastify.post('/mock-data/reset', async (_request, reply) => {
        try {
            await resetMockData();
            return { success: true, message: 'Mock data reset and reseeded successfully' };
        } catch (error) {
            Logger.error('[Admin] Failed to reset mock data', { error });
            return reply.code(500).send({ error: 'Failed to reset mock data' });
        }
    });
};

export default mockDataRoutes;
