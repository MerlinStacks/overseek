/**
 * EmbeddingService - pgvector Semantic Search
 * 
 * Generates and stores vector embeddings for products using OpenRouter
 * and performs similarity search using pgvector.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

// Default embedding model
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

interface EmbeddingResult {
    id: string;
    name: string;
    similarity: number;
}

export class EmbeddingService {
    /**
     * Generate embedding using OpenRouter API
     */
    static async generateEmbedding(text: string, apiKey: string, model: string = DEFAULT_EMBEDDING_MODEL): Promise<number[]> {
        if (!apiKey) {
            throw new Error('OpenRouter API key required for embeddings');
        }

        try {
            const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': process.env.APP_URL || 'https://overseek.app',
                    'X-Title': 'Overseek Commerce Platform'
                },
                body: JSON.stringify({
                    model: model,
                    input: text.slice(0, 8000) // Max input length
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || 'Embedding generation failed');
            }

            const data = await response.json();
            return data.data[0].embedding;
        } catch (error) {
            Logger.error('Failed to generate embedding', { error, model });
            throw error;
        }
    }

    /**
     * Generate searchable text from a product
     */
    static getProductSearchText(product: any): string {
        const parts = [
            product.name,
            product.sku,
            product.description,
            product.shortDescription,
            product.categories?.map((c: any) => c.name).join(' '),
            product.tags?.map((t: any) => t.name).join(' ')
        ].filter(Boolean);

        return parts.join(' ').slice(0, 8000);
    }

    /**
     * Update embedding for a single product
     */
    static async updateProductEmbedding(productId: string, accountId: string): Promise<void> {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { openRouterApiKey: true, embeddingModel: true }
        });

        const apiKey = account?.openRouterApiKey;
        if (!apiKey) {
            Logger.warn('No API key available for embeddings', { productId, accountId });
            return;
        }

        const product = await prisma.wooProduct.findUnique({
            where: { id: productId }
        });

        if (!product) return;

        const searchText = this.getProductSearchText(product.rawData);
        const model = account.embeddingModel || DEFAULT_EMBEDDING_MODEL;
        const embedding = await this.generateEmbedding(searchText, apiKey, model);

        // Store embedding using raw SQL (pgvector)
        await prisma.$executeRaw`
            UPDATE "WooProduct" 
            SET embedding = ${embedding}::vector
            WHERE id = ${productId}
        `;

        Logger.debug('Updated product embedding', { productId });
    }

    /**
     * Batch update embeddings for all products
     */
    static async batchUpdateEmbeddings(accountId: string, limit: number = 100): Promise<number> {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { openRouterApiKey: true, embeddingModel: true }
        });

        const apiKey = account?.openRouterApiKey;
        if (!apiKey) {
            throw new Error('No OpenRouter API key available for embeddings');
        }

        const model = account.embeddingModel || DEFAULT_EMBEDDING_MODEL;

        // Find products without embeddings
        const products = await prisma.$queryRaw<{ id: string; rawData: any }[]>`
            SELECT id, "rawData" 
            FROM "WooProduct" 
            WHERE "accountId" = ${accountId} 
            AND embedding IS NULL
            LIMIT ${limit}
        `;

        let updated = 0;
        for (const product of products) {
            try {
                const searchText = this.getProductSearchText(product.rawData);
                const embedding = await this.generateEmbedding(searchText, apiKey, model);

                await prisma.$executeRaw`
                    UPDATE "WooProduct" 
                    SET embedding = ${embedding}::vector
                    WHERE id = ${product.id}
                `;

                updated++;

                // Rate limit: 100 requests per minute for OpenAI
                await new Promise(resolve => setTimeout(resolve, 600));
            } catch (error) {
                Logger.error('Failed to update embedding', { productId: product.id, error });
            }
        }

        Logger.info('Batch embedding update complete', { accountId, updated });
        return updated;
    }

    /**
     * Semantic search using pgvector cosine similarity
     */
    static async semanticSearch(
        accountId: string,
        query: string,
        limit: number = 10
    ): Promise<EmbeddingResult[]> {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { openRouterApiKey: true, embeddingModel: true }
        });

        const apiKey = account?.openRouterApiKey;
        if (!apiKey) {
            throw new Error('No OpenRouter API key available for semantic search');
        }

        const model = account.embeddingModel || DEFAULT_EMBEDDING_MODEL;

        // Generate embedding for query
        const queryEmbedding = await this.generateEmbedding(query, apiKey, model);

        // Search using pgvector cosine distance
        const results = await prisma.$queryRaw<EmbeddingResult[]>`
            SELECT 
                id, 
                name,
                1 - (embedding <=> ${queryEmbedding}::vector) as similarity
            FROM "WooProduct"
            WHERE "accountId" = ${accountId}
            AND embedding IS NOT NULL
            ORDER BY embedding <=> ${queryEmbedding}::vector
            LIMIT ${limit}
        `;

        return results;
    }

    /**
     * Find similar products to a given product
     */
    static async findSimilarProducts(
        productId: string,
        accountId: string,
        limit: number = 5
    ): Promise<EmbeddingResult[]> {
        const results = await prisma.$queryRaw<EmbeddingResult[]>`
            SELECT 
                p2.id, 
                p2.name,
                1 - (p1.embedding <=> p2.embedding) as similarity
            FROM "WooProduct" p1
            JOIN "WooProduct" p2 ON p2."accountId" = p1."accountId"
            WHERE p1.id = ${productId}
            AND p2.id != ${productId}
            AND p1."accountId" = ${accountId}
            AND p1.embedding IS NOT NULL
            AND p2.embedding IS NOT NULL
            ORDER BY p1.embedding <=> p2.embedding
            LIMIT ${limit}
        `;

        return results;
    }
}

export default EmbeddingService;
