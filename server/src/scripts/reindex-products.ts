
import { PrismaClient } from '@prisma/client';
import { IndexingService } from '../services/search/IndexingService';
import { ProductsService } from '../services/products';
import { Logger } from '../utils/logger';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
    console.log('Starting product re-indexing...');
    console.log('Elasticsearch URL:', process.env.ELASTICSEARCH_URL);

    // 1. Update Mappings
    try {
        await IndexingService.initializeIndices();
        console.log('Indices initialized/updated.');
    } catch (err) {
        console.error('Failed to initialize indices:', err);
        return;
    }

    // 2. Fetch all accounts
    const accounts = await prisma.account.findMany();

    for (const account of accounts) {
        console.log(`Processing account: ${account.name} (${account.id})`);

        let count = 0;
        let cursor = undefined;

        while (true) {
            const products = await prisma.wooProduct.findMany({
                where: { accountId: account.id },
                take: 50,
                skip: cursor ? 1 : 0,
                cursor: cursor ? { id: cursor } : undefined,
                orderBy: { id: 'asc' },
                include: { variations: true }
            });

            if (products.length === 0) break;

            for (const p of products) {
                const fullProduct = await ProductsService.getProductByWooId(account.id, p.wooId);
                if (fullProduct) {
                    try {
                        await IndexingService.indexProduct(account.id, fullProduct);
                    } catch (e) {
                        console.error(`Failed to index product ${p.id}:`, e);
                    }
                }
                cursor = p.id;
            }

            count += products.length;
            console.log(`  Indexed ${count} products...`);
        }
    }

    console.log('Re-indexing complete.');
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
