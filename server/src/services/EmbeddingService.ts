import { prisma } from '../utils/prisma';
import { z } from 'zod';
import { claimProviderWork, providerJson, scopeId } from './BoundedProviderWork';
const MODEL = 'openai/text-embedding-3-small', DIMENSIONS = 1536;
interface EmbeddingResult { id: string; name: string; similarity: number }
function limitValue(value: number) { return z.number().int().min(1).max(100).parse(value); }
export class EmbeddingService {
    static async hasEmbeddingColumn(): Promise<boolean> {
        const rows = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'WooProduct' AND column_name IN ('embedding', 'embeddingSourceVersion', 'embeddingModelId', 'embeddingDimensions')`;
        return Number(rows[0]?.count) === 4;
    }
    static async generateEmbeddings(texts: string[], apiKey: string, model = MODEL): Promise<number[][]> {
        z.array(z.string().min(1).max(8000)).min(1).max(100).parse(texts);
        if (texts.reduce((sum, value) => sum + Buffer.byteLength(value), 0) > 200000 || model !== MODEL || !apiKey) throw new Error('Unsupported embedding input/model');
        const data = z.object({ data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number().finite()).length(DIMENSIONS) })).length(texts.length) }).parse(await providerJson('https://openrouter.ai/api/v1/embeddings', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: texts, dimensions: DIMENSIONS }) }, 8000000));
        const sorted = data.data.sort((a, b) => a.index - b.index);
        if (sorted.some((row, index) => row.index !== index || !row.embedding.some(value => value !== 0))) throw new Error('Incomplete embedding coverage');
        return sorted.map(row => row.embedding);
    }
    static async generateEmbedding(text: string, apiKey: string, model = MODEL) { return (await this.generateEmbeddings([text], apiKey, model))[0]; }
    static getProductSearchText(input: unknown): string {
        const product = z.object({ name: z.string(), sku: z.string().nullish(), description: z.string().nullish(), shortDescription: z.string().nullish(), categories: z.array(z.object({ name: z.string() })).max(100).optional(), tags: z.array(z.object({ name: z.string() })).max(100).optional() }).parse(input);
        const text = [product.name, product.sku, product.description, product.shortDescription, product.categories?.map(c => c.name).join(' '), product.tags?.map(t => t.name).join(' ')].filter(Boolean).join(' ');
        return z.string().min(1).max(8000).parse(text); // Oversize is unsupported, not silently truncated coverage.
    }
    private static async account(accountId: string) {
        scopeId.parse(accountId);
        if (!await this.hasEmbeddingColumn()) throw new Error('Embedding projection unavailable; provenance migration required');
        const account = await prisma.account.findUnique({ where: { id: accountId }, select: { openRouterApiKey: true, embeddingModel: true } });
        if (!account?.openRouterApiKey || (account.embeddingModel && account.embeddingModel !== MODEL)) throw new Error('Supported embedding configuration required');
        return account;
    }
    private static async requireCoverage(accountId: string, db: Pick<typeof prisma, '$queryRaw'> = prisma) {
        const [coverage] = await db.$queryRaw<{ total: bigint; current: bigint }[]>`SELECT count(*) AS total, count(*) FILTER (WHERE embedding IS NOT NULL AND "embeddingSourceVersion" = "updatedAt" AND "embeddingModelId" = ${MODEL} AND "embeddingDimensions" = ${DIMENSIONS}) AS current FROM "WooProduct" WHERE "accountId" = ${accountId}`;
        const parsed = z.object({ total: z.bigint().nonnegative(), current: z.bigint().nonnegative() }).safeParse(coverage);
        if (!parsed.success || parsed.data.total !== parsed.data.current) throw new Error('Semantic projection coverage incomplete/unavailable; no empty-success search is asserted');
    }
    static async updateProductEmbedding(productId: string, accountId: string, _accountData?: unknown, _productData?: unknown): Promise<void> {
        scopeId.parse(productId);
        const account = await this.account(accountId);
        const product = await prisma.wooProduct.findFirst({ where: { id: productId, accountId }, select: { id: true, rawData: true, updatedAt: true } });
        if (!product) throw new Error('Scoped product unavailable');
        const release = await claimProviderWork(accountId, 'embedding', 1);
        try {
            const vector = JSON.stringify(await this.generateEmbedding(this.getProductSearchText(product.rawData), account.openRouterApiKey!, MODEL));
            const count = await prisma.$executeRaw`UPDATE "WooProduct" SET embedding = ${vector}::vector, "embeddingSourceVersion" = ${product.updatedAt}, "embeddingModelId" = ${MODEL}, "embeddingDimensions" = ${DIMENSIONS} WHERE id = ${productId} AND "accountId" = ${accountId} AND "updatedAt" = ${product.updatedAt}`;
            if (count !== 1) throw new Error('Embedding source changed; projection not acknowledged');
        } finally { await release(); }
    }
    static async batchUpdateEmbeddings(accountId: string, limit = 100): Promise<number> {
        limitValue(limit); const account = await this.account(accountId);
        const products = await prisma.$queryRaw<{ id: string; rawData: unknown; updatedAt: Date }[]>`SELECT id, "rawData", "updatedAt" FROM "WooProduct" WHERE "accountId" = ${accountId} AND (embedding IS NULL OR "embeddingSourceVersion" IS DISTINCT FROM "updatedAt" OR "embeddingModelId" IS DISTINCT FROM ${MODEL}) ORDER BY id LIMIT ${limit}`;
        if (!products.length) return 0;
        const release = await claimProviderWork(accountId, 'embedding', products.length);
        try {
            const vectors = await this.generateEmbeddings(products.map(product => this.getProductSearchText(product.rawData)), account.openRouterApiKey!, MODEL);
            await prisma.$transaction(async tx => {
                for (let index = 0; index < products.length; index++) {
                    const product = products[index], vector = JSON.stringify(vectors[index]);
                    const changed = await tx.$executeRaw`UPDATE "WooProduct" SET embedding = ${vector}::vector, "embeddingSourceVersion" = ${product.updatedAt}, "embeddingModelId" = ${MODEL}, "embeddingDimensions" = ${DIMENSIONS} WHERE id = ${product.id} AND "accountId" = ${accountId} AND "updatedAt" = ${product.updatedAt}`;
                    if (changed !== 1) throw new Error('Embedding batch source changed');
                }
            });
            return products.length; // Capped projection count, not full-account coverage.
        } finally { await release(); }
    }
    static async semanticSearch(accountId: string, query: string, limit = 10): Promise<EmbeddingResult[]> {
        limitValue(limit); const account = await this.account(accountId); await this.requireCoverage(accountId);
        const release = await claimProviderWork(accountId, 'embedding', 1);
        try {
            const vector = JSON.stringify(await this.generateEmbedding(query, account.openRouterApiKey!, MODEL));
            return await prisma.$transaction(async tx => {
                await this.requireCoverage(accountId, tx);
                return tx.$queryRaw<EmbeddingResult[]>`SELECT id, name, 1 - (embedding <=> ${vector}::vector) AS similarity FROM "WooProduct" WHERE "accountId" = ${accountId} AND embedding IS NOT NULL AND "embeddingSourceVersion" = "updatedAt" AND "embeddingModelId" = ${MODEL} AND "embeddingDimensions" = ${DIMENSIONS} ORDER BY embedding <=> ${vector}::vector, id LIMIT ${limit}`;
            }, { isolationLevel: 'RepeatableRead' });
        } finally { await release(); }
    }
    static async findSimilarProducts(productId: string, accountId: string, limit = 5): Promise<EmbeddingResult[]> {
        scopeId.parse(productId); limitValue(limit); await this.account(accountId); await this.requireCoverage(accountId);
        if (!await prisma.wooProduct.findFirst({ where: { id: productId, accountId }, select: { id: true } })) throw new Error('Scoped similarity source unavailable');
        return prisma.$transaction(async tx => {
            await this.requireCoverage(accountId, tx);
            return tx.$queryRaw<EmbeddingResult[]>`SELECT p2.id, p2.name, 1 - (p1.embedding <=> p2.embedding) AS similarity FROM "WooProduct" p1 JOIN "WooProduct" p2 ON p1."accountId" = p2."accountId" WHERE p1.id = ${productId} AND p1."accountId" = ${accountId} AND p2.id != ${productId} AND p1.embedding IS NOT NULL AND p2.embedding IS NOT NULL AND p1."embeddingSourceVersion" = p1."updatedAt" AND p2."embeddingSourceVersion" = p2."updatedAt" AND p1."embeddingModelId" = ${MODEL} AND p2."embeddingModelId" = ${MODEL} AND p1."embeddingDimensions" = ${DIMENSIONS} AND p2."embeddingDimensions" = ${DIMENSIONS} ORDER BY p1.embedding <=> p2.embedding, p2.id LIMIT ${limit}`;
        }, { isolationLevel: 'RepeatableRead' });
    }
}
export default EmbeddingService;
