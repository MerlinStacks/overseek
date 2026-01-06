import { esClient } from '../../utils/elastic';
import { Logger } from '../../utils/logger';

export class IndexingService {

    private static async createIndexIfNotExists(indexName: string, mapping: any) {
        try {
            const exists = await esClient.indices.exists({ index: indexName });
            if (!exists) {
                await esClient.indices.create({
                    index: indexName,
                    body: {
                        settings: (mapping as any).settings || {},
                        mappings: { properties: (mapping as any).properties || mapping }
                    }
                });
                Logger.info(`Elasticsearch index '${indexName}' created.`);
            } else {
                // Update settings for existing index
                if ((mapping as any).settings) {
                    await esClient.indices.putSettings({
                        index: indexName,
                        body: (mapping as any).settings
                    });
                }
                // Update mapping for existing index (merge new fields)
                await esClient.indices.putMapping({
                    index: indexName,
                    body: { properties: (mapping as any).properties || mapping }
                });
                Logger.info(`Updated mapping for existing index '${indexName}'`);
            }
        } catch (error: any) {
            Logger.error(`Failed to create index ${indexName}`, { error: error.message });
        }
    }

    static async initializeIndices() {
        Logger.info('Initializing Elasticsearch indices...');
        const commonSettings = { number_of_shards: 1, number_of_replicas: 0 };

        // 1. Customers
        await this.createIndexIfNotExists('customers', {
            settings: {
                max_result_window: 50000
            },
            properties: {
                accountId: { type: 'keyword' },
                id: { type: 'integer' },
                email: { type: 'keyword' },
                firstName: { type: 'text' },
                lastName: { type: 'text' },
                totalSpent: { type: 'float' },
                ordersCount: { type: 'integer' },
                dateCreated: { type: 'date' }
            }
        });

        // 2. Products
        await this.createIndexIfNotExists('products', {
            settings: {
                max_result_window: 50000
            },
            properties: {
                accountId: { type: 'keyword' },
                id: { type: 'integer' },
                name: { type: 'text' },
                sku: { type: 'keyword' },
                stock_status: { type: 'keyword' },
                price: { type: 'float' },
                date_created: { type: 'date' },
                images: { type: 'nested', properties: { src: { type: 'keyword' } } },
                categories: { type: 'nested', properties: { name: { type: 'keyword' } } },
                seoScore: { type: 'integer' },
                merchantCenterScore: { type: 'integer' }
            }
        });

        // 3. Orders
        await this.createIndexIfNotExists('orders', {
            settings: {
                max_result_window: 50000
            },
            properties: {
                accountId: { type: 'keyword' },
                id: { type: 'integer' },
                status: { type: 'keyword' },
                total: { type: 'float' },
                currency: { type: 'keyword' },
                date_created: { type: 'date' },
                billing: { properties: { first_name: { type: 'text' }, last_name: { type: 'text' }, email: { type: 'keyword' } } },
                line_items: {
                    type: 'nested',
                    properties: {
                        name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
                        sku: { type: 'keyword' },
                        productId: { type: 'integer' },
                        quantity: { type: 'integer' },
                        meta_data: {
                            type: 'nested',
                            properties: { key: { type: 'keyword' }, value: { type: 'text' } }
                        }
                    }
                },
            }
        });

        // 4. Ad Spend
        await this.createIndexIfNotExists('ad_spend', {
            settings: {
                max_result_window: 50000
            },
            properties: {
                accountId: { type: 'keyword' },
                spend: { type: 'float' },
                impressions: { type: 'integer' },
                clicks: { type: 'integer' },
                roas: { type: 'float' },
                currency: { type: 'keyword' },
                date_start: { type: 'date' },
                date_stop: { type: 'date' }
            }
        });

        // 5. Reviews
        await this.createIndexIfNotExists('reviews', {
            settings: {
                max_result_window: 50000
            },
            properties: {
                accountId: { type: 'keyword' },
                id: { type: 'integer' },
                productId: { type: 'integer' },
                productName: { type: 'text' },
                reviewer: { type: 'text' },
                rating: { type: 'integer' },
                content: { type: 'text' },
                status: { type: 'keyword' },
                dateCreated: { type: 'date' }
            }
        });

        Logger.info('Elasticsearch indices initialization complete.');
    }

    static async indexCustomer(accountId: string, customer: any) {
        await this.createIndexIfNotExists('customers', {
            properties: {
                accountId: { type: 'keyword' },
                id: { type: 'integer' },
                email: { type: 'keyword' },
                firstName: { type: 'text' },
                lastName: { type: 'text' },
                totalSpent: { type: 'float' },
                ordersCount: { type: 'integer' },
                dateCreated: { type: 'date' }
            }
        });

        await esClient.index({
            index: 'customers',
            id: `${accountId}_${customer.id}`,
            body: {
                accountId,
                id: customer.id,
                email: customer.email,
                firstName: customer.first_name,
                lastName: customer.last_name,
                totalSpent: parseFloat(customer.total_spent || '0'),
                ordersCount: customer.orders_count || 0,
                dateCreated: customer.date_created
            },
            refresh: true // Careful with performance on bulk
        });
    }

    static async indexProduct(accountId: string, product: any) {
        await this.createIndexIfNotExists('products', {
            properties: {
                accountId: { type: 'keyword' },
                id: { type: 'integer' },
                name: { type: 'text' },
                sku: { type: 'keyword' },
                stock_status: { type: 'keyword' },
                price: { type: 'float' },
                date_created: { type: 'date' },
                images: { type: 'nested', properties: { src: { type: 'keyword' } } },
                categories: { type: 'nested', properties: { name: { type: 'keyword' } } },
                seoScore: { type: 'integer' },
                merchantCenterScore: { type: 'integer' }
            }
        });

        await esClient.index({
            index: 'products',
            id: `${accountId}_${product.id}`,
            body: {
                accountId,
                id: product.id,
                name: product.name,
                sku: product.sku,
                stock_status: product.stock_status,
                price: parseFloat(product.price || '0'),
                date_created: product.date_created,
                images: product.images?.map((img: any) => ({ src: img.src })) || [],
                categories: product.categories?.map((cat: any) => ({ name: cat.name })) || [],
                seoScore: product.seoScore || 0,
                merchantCenterScore: product.merchantCenterScore || 0
            },
            refresh: true
        });
    }

    static async indexOrder(accountId: string, order: any) {
        await this.createIndexIfNotExists('orders', {
            properties: {
                accountId: { type: 'keyword' },
                id: { type: 'integer' },
                status: { type: 'keyword' },
                total: { type: 'float' },
                currency: { type: 'keyword' },
                date_created: { type: 'date' },
                billing: { properties: { first_name: { type: 'text' }, last_name: { type: 'text' }, email: { type: 'keyword' } } },
                line_items: {
                    type: 'nested',
                    properties: {
                        name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
                        sku: { type: 'keyword' },
                        productId: { type: 'integer' },
                        quantity: { type: 'integer' },
                        meta_data: {
                            type: 'nested',
                            properties: { key: { type: 'keyword' }, value: { type: 'text' } }
                        }
                    }
                },
                meta_data: {
                    type: 'nested',
                    properties: { key: { type: 'keyword' }, value: { type: 'text' } }
                }
            }
        });

        await esClient.index({
            index: 'orders',
            id: `${accountId}_${order.id}`,
            body: {
                accountId,
                id: order.id,
                status: order.status,
                total: parseFloat(order.total),
                currency: order.currency,
                date_created: order.date_created,
                billing: order.billing,
                line_items: order.line_items?.map((item: any) => ({
                    name: item.name,
                    sku: item.sku,
                    productId: item.product_id,
                    quantity: item.quantity,
                    meta_data: item.meta_data?.map((m: any) => ({
                        key: m.key,
                        value: typeof m.value === 'string' ? m.value : JSON.stringify(m.value)
                    })) || []
                })) || [],
                meta_data: order.meta_data?.map((m: any) => ({
                    key: m.key,
                    value: typeof m.value === 'string' ? m.value : JSON.stringify(m.value)
                })) || []
            },
            refresh: true
        });
    }

    static async indexReview(accountId: string, review: any) {
        await this.createIndexIfNotExists('reviews', {
            properties: {
                accountId: { type: 'keyword' },
                id: { type: 'integer' },
                productId: { type: 'integer' },
                productName: { type: 'text' },
                reviewer: { type: 'text' },
                rating: { type: 'integer' },
                content: { type: 'text' },
                status: { type: 'keyword' },
                dateCreated: { type: 'date' }
            }
        });

        await esClient.index({
            index: 'reviews',
            id: `${accountId}_${review.id}`,
            body: {
                accountId,
                id: review.id,
                productId: review.product_id,
                productName: review.product_name,
                reviewer: review.reviewer,
                rating: review.rating,
                content: review.review, // Map 'review' to 'content'
                status: review.status,
                dateCreated: review.date_created
            },
            refresh: true
        });
    }

    static async deleteAccountData(accountId: string) {
        Logger.info(`Deleting Elasticsearch data for account ${accountId}...`);
        const indices = ['customers', 'products', 'orders', 'reviews', 'ad_spend'];

        for (const index of indices) {
            try {
                const exists = await esClient.indices.exists({ index });
                if (exists) {
                    await esClient.deleteByQuery({
                        index,
                        body: {
                            query: {
                                term: { accountId: accountId }
                            }
                        },
                        refresh: true
                    });
                }
            } catch (error: any) {
                Logger.error(`Failed to delete data from index ${index} for account ${accountId}`, { error: error.message });
            }
        }

        // Failsafe Verification
        let remainingDocs = 0;
        for (const index of indices) {
            try {
                const exists = await esClient.indices.exists({ index });
                if (exists) {
                    const { count } = await esClient.count({
                        index,
                        body: {
                            query: {
                                term: { accountId: accountId }
                            }
                        }
                    });
                    if (count > 0) {
                        remainingDocs += count;
                        Logger.warn(`Failsafe Warning: ${count} documents remain in ${index} for account ${accountId} after deletion query.`);
                    }
                }
            } catch (e) { /* ignore check error */ }
        }

        if (remainingDocs === 0) {
            Logger.info(`Successfully verified deletion of all ES data for account ${accountId}.`);
        }
    }
}
