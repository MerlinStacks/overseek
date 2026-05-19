import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { setupMockAccount } from './setupMockAccount';

const PRODUCT_COUNT = Number(process.env.MOCK_PRODUCTS_COUNT ?? '12');
const CUSTOMER_COUNT = Number(process.env.MOCK_CUSTOMERS_COUNT ?? '8');
const ORDER_COUNT = Number(process.env.MOCK_ORDERS_COUNT ?? '20');

const now = new Date();

function roundToCents(value: number): string {
    return value.toFixed(2);
}

async function seedMockData(): Promise<void> {
    const { accountId } = await setupMockAccount();

    let createdProducts = 0;
    let createdCustomers = 0;
    let createdOrders = 0;

    for (let i = 1; i <= PRODUCT_COUNT; i++) {
        const wooId = 90_000 + i;
        const price = roundToCents(19 + i * 3.5);
        const stockQuantity = 3 + ((i * 7) % 40);
        const stockStatus = stockQuantity > 0 ? 'instock' : 'outofstock';

        await prisma.wooProduct.upsert({
            where: { accountId_wooId: { accountId, wooId } },
            update: {
                name: `Mock Product ${i}`,
                sku: `MOCK-SKU-${i.toString().padStart(3, '0')}`,
                price,
                stockStatus,
                stockQuantity,
                manageStock: true,
                permalink: `https://mock-store.local/product/mock-product-${i}`,
                rawData: {
                    id: wooId,
                    name: `Mock Product ${i}`,
                    status: 'publish',
                    price,
                    sku: `MOCK-SKU-${i.toString().padStart(3, '0')}`,
                    stock_status: stockStatus,
                    stock_quantity: stockQuantity,
                    permalink: `https://mock-store.local/product/mock-product-${i}`,
                },
            },
            create: {
                accountId,
                wooId,
                name: `Mock Product ${i}`,
                sku: `MOCK-SKU-${i.toString().padStart(3, '0')}`,
                price,
                stockStatus,
                stockQuantity,
                manageStock: true,
                permalink: `https://mock-store.local/product/mock-product-${i}`,
                rawData: {
                    id: wooId,
                    name: `Mock Product ${i}`,
                    status: 'publish',
                    price,
                    sku: `MOCK-SKU-${i.toString().padStart(3, '0')}`,
                    stock_status: stockStatus,
                    stock_quantity: stockQuantity,
                    permalink: `https://mock-store.local/product/mock-product-${i}`,
                },
            },
        });

        createdProducts++;
    }

    for (let i = 1; i <= CUSTOMER_COUNT; i++) {
        const wooId = 70_000 + i;
        const email = `customer${i}@mock-store.local`;
        const ordersCount = 1 + (i % 4);
        const totalSpent = roundToCents(60 + i * 42.25);

        await prisma.wooCustomer.upsert({
            where: { accountId_wooId: { accountId, wooId } },
            update: {
                email,
                firstName: `Customer${i}`,
                lastName: 'Mock',
                ordersCount,
                totalSpent,
                rawData: {
                    id: wooId,
                    email,
                    first_name: `Customer${i}`,
                    last_name: 'Mock',
                    orders_count: ordersCount,
                    total_spent: totalSpent,
                },
            },
            create: {
                accountId,
                wooId,
                email,
                firstName: `Customer${i}`,
                lastName: 'Mock',
                ordersCount,
                totalSpent,
                rawData: {
                    id: wooId,
                    email,
                    first_name: `Customer${i}`,
                    last_name: 'Mock',
                    orders_count: ordersCount,
                    total_spent: totalSpent,
                },
            },
        });

        createdCustomers++;
    }

    for (let i = 1; i <= ORDER_COUNT; i++) {
        const wooId = 80_000 + i;
        const customerIndex = ((i - 1) % CUSTOMER_COUNT) + 1;
        const billingEmail = `customer${customerIndex}@mock-store.local`;
        const wooCustomerId = 70_000 + customerIndex;
        const total = roundToCents(45 + i * 11.8);
        const dateCreated = new Date(now.getTime() - i * 86_400_000);
        const status = i % 5 === 0 ? 'completed' : 'processing';

        await prisma.wooOrder.upsert({
            where: { accountId_wooId: { accountId, wooId } },
            update: {
                number: `${wooId}`,
                status,
                currency: 'USD',
                total,
                billingEmail,
                billingCountry: 'US',
                wooCustomerId,
                dateCreated,
                dateModified: dateCreated,
                rawData: {
                    id: wooId,
                    number: `${wooId}`,
                    status,
                    currency: 'USD',
                    total,
                    customer_id: wooCustomerId,
                    billing: {
                        email: billingEmail,
                        country: 'US',
                    },
                    date_created: dateCreated.toISOString(),
                    date_modified: dateCreated.toISOString(),
                },
            },
            create: {
                accountId,
                wooId,
                number: `${wooId}`,
                status,
                currency: 'USD',
                total,
                billingEmail,
                billingCountry: 'US',
                wooCustomerId,
                dateCreated,
                dateModified: dateCreated,
                rawData: {
                    id: wooId,
                    number: `${wooId}`,
                    status,
                    currency: 'USD',
                    total,
                    customer_id: wooCustomerId,
                    billing: {
                        email: billingEmail,
                        country: 'US',
                    },
                    date_created: dateCreated.toISOString(),
                    date_modified: dateCreated.toISOString(),
                },
            },
        });

        createdOrders++;
    }

    Logger.info('[seedMockData] Mock data seeded', {
        accountId,
        products: createdProducts,
        customers: createdCustomers,
        orders: createdOrders,
    });
}

if (require.main === module) {
    seedMockData()
        .then(() => process.exit(0))
        .catch((error) => {
            Logger.error('[seedMockData] Failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            process.exit(1);
        });
}

export { seedMockData };
