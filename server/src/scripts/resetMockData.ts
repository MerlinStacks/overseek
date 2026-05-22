import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { setupMockAccount } from './setupMockAccount';
import { seedMockData } from './seedMockData';

const SHOULD_RESEED = (process.env.MOCK_RESEED ?? 'true').toLowerCase() !== 'false';

async function resetMockData(): Promise<void> {
    const { accountId } = await setupMockAccount();

    const [deletedOrders, deletedProducts, deletedCustomers] = await prisma.$transaction([
        prisma.wooOrder.deleteMany({ where: { accountId } }),
        prisma.wooProduct.deleteMany({ where: { accountId } }),
        prisma.wooCustomer.deleteMany({ where: { accountId } }),
    ]);

    Logger.info('[resetMockData] Cleared mock Woo data', {
        accountId,
        deletedOrders: deletedOrders.count,
        deletedProducts: deletedProducts.count,
        deletedCustomers: deletedCustomers.count,
    });

    if (SHOULD_RESEED) {
        await seedMockData();
        Logger.info('[resetMockData] Reseeded mock Woo data', { accountId });
    } else {
        Logger.info('[resetMockData] Skipped reseed (MOCK_RESEED=false)', { accountId });
    }
}

if (require.main === module) {
    resetMockData()
        .then(() => process.exit(0))
        .catch((error) => {
            Logger.error('[resetMockData] Failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            process.exit(1);
        });
}

export { resetMockData };
