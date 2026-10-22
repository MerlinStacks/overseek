import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import path from 'path';
import { runInNewContext } from 'vm';
import { operationalOptions, safeDestination } from './operationalSafety';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200);
const article = z.object({ title: z.string().trim().min(1).max(200), slug, content: z.string().trim().min(1).max(500000), excerpt: z.string().max(2000).default(''), order: z.number().int().min(0).max(1000000) });
const collectionsSchema = z.array(z.object({ title: z.string().trim().min(1).max(200), slug, description: z.string().max(2000).default(''), icon: z.string().max(100).default(''), order: z.number().int().min(0).max(1000000), articles: z.array(article).max(200) })).max(50);
export interface HelpSeedOptions { apply: boolean; overwrite: boolean; publish: boolean }

/** Load this repository's static TS content without a cross-root TypeScript import or DB clients. */
export async function loadCollections(): Promise<unknown> {
    const { build } = await import('esbuild');
    const output = await build({ entryPoints: [path.resolve(__dirname, '../../../client/src/data/helpContent.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' });
    const module = { exports: {} as { getHelpCollections?: () => unknown } };
    runInNewContext(output.outputFiles[0].text, { module, exports: module.exports }, { timeout: 1000 });
    if (typeof module.exports.getHelpCollections !== 'function') throw new Error('Static help content export unavailable');
    return module.exports.getHelpCollections();
}

/** Dry-run reads only. An applied seed commits atomically, preserves existing text by default. */
export async function seedHelpContent(input: unknown, options: HelpSeedOptions, db: PrismaClient) {
    const collections = collectionsSchema.parse(input);
    const articleSlugs = collections.flatMap(collection => collection.articles.map(item => item.slug));
    if (new Set(collections.map(collection => collection.slug)).size !== collections.length || new Set(articleSlugs).size !== articleSlugs.length || articleSlugs.length > 1000) throw new Error('Duplicate seed slugs or seed coverage limit exceeded');
    const process = async (client: Pick<PrismaClient, 'helpCollection' | 'helpArticle'>) => {
        const summary = { dryRun: !options.apply, collections: collections.length, articles: articleSlugs.length, created: 0, updated: 0, preserved: 0, publish: options.publish };
        for (const collection of collections) {
            const { articles, ...data } = collection;
            const existing = await client.helpCollection.findUnique({ where: { slug: data.slug } });
            let collectionId = existing?.id;
            if (existing && !options.overwrite) summary.preserved++;
            else {
                if (existing) summary.updated++; else summary.created++;
                if (options.apply) collectionId = (await client.helpCollection.upsert({ where: { slug: data.slug }, update: data, create: data })).id;
            }
            for (const item of articles) {
                const previous = await client.helpArticle.findUnique({ where: { slug: item.slug } });
                if (previous && !options.overwrite) { summary.preserved++; continue; }
                if (previous) summary.updated++; else summary.created++;
                if (options.apply) await client.helpArticle.upsert({ where: { slug: item.slug },
                    update: { ...item, collectionId, ...(options.publish ? { isPublished: true } : {}) }, create: { ...item, collectionId, isPublished: options.publish } });
            }
        }
        return summary;
    };
    return options.apply ? db.$transaction(tx => process(tx), { timeout: 60000 }) : process(db);
}
export async function main(args = process.argv.slice(2)) {
    if (args.includes('--help')) { console.info('seedHelpContent: --all [--dry-run] [--apply --confirm=seed-help-content:ALL:DB_HOST/DB_NAME] [--overwrite] [--publish]. Dry-run, preserve existing content, and draft publication are defaults.'); return; }
    if (args.some(value => !['--all', '--dry-run', '--apply', '--overwrite', '--publish'].includes(value) && !value.startsWith('--confirm='))) throw new Error('Unsupported seed option; use --help');
    if (args.filter(value => value === '--overwrite').length > 1 || args.filter(value => value === '--publish').length > 1) throw new Error('Duplicate seed flags');
    (await import('dotenv')).config();
    const options = operationalOptions('seed-help-content', args.filter(value => !['--overwrite', '--publish'].includes(value)));
    if (!options.all) throw new Error('Help content is global; use --all explicitly');
    const input = await loadCollections();
    const { createPrismaClient } = await import('../utils/prisma'); const db = createPrismaClient();
    try { console.info('Help seed outcome', { destination: safeDestination(process.env.DATABASE_URL), ...await seedHelpContent(input, { apply: options.apply, overwrite: args.includes('--overwrite'), publish: args.includes('--publish') }, db) }); }
    finally { await db.$disconnect(); }
}
if (require.main === module) void main().catch(() => { console.error('Help seed failed; no successful seed was reported. Check inputs, destination and confirmation.'); process.exitCode = 1; });
