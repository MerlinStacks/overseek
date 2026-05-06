/**
 * Help Content Seed Script
 *
 * Seeds the database with static help content from the client package.
 * Run with: npx ts-node src/scripts/seedHelpContent.ts
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

// @ts-expect-error — cross-package import for one-time seeding.
// Client uses ESM; dynamic import is required in CJS server context.
async function loadCollections(): Promise<Record<string, unknown>[]> {
    try {
        const clientModule = await import('../../../client/src/data/helpContent');
        return clientModule.helpCollections || [];
    } catch (e) {
        Logger.warn('[seedHelpContent] Could not import client helpContent. Falling back to empty seed.', { error: String(e) });
        return [];
    }
}

export async function seedHelpContent(): Promise<void> {
    const collections = await loadCollections();
    if (collections.length === 0) {
        Logger.info('[seedHelpContent] No collections to seed. Exiting.');
        return;
    }

    for (const collection of collections) {
        const upserted = await prisma.helpCollection.upsert({
            where: { slug: collection.slug },
            update: {
                title: collection.title,
                description: collection.description,
                icon: collection.icon,
                order: collection.order,
            },
            create: {
                id: collection.id,
                slug: collection.slug,
                title: collection.title,
                description: collection.description,
                icon: collection.icon,
                order: collection.order,
            },
        });

        for (const article of collection.articles || []) {
            await prisma.helpArticle.upsert({
                where: { slug: article.slug },
                update: {
                    title: article.title,
                    content: article.content,
                    excerpt: article.excerpt,
                    order: article.order,
                    isPublished: true,
                    collectionId: upserted.id,
                },
                create: {
                    id: article.id,
                    slug: article.slug,
                    title: article.title,
                    content: article.content,
                    excerpt: article.excerpt,
                    order: article.order,
                    isPublished: true,
                    collectionId: upserted.id,
                },
            });
        }
    }

    Logger.info(`[seedHelpContent] Seeded ${collections.length} collections.`);
}

if (require.main === module) {
    seedHelpContent()
        .then(() => process.exit(0))
        .catch((err) => {
            Logger.error('[seedHelpContent] Failed', { error: err instanceof Error ? (err instanceof Error ? (err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err)) : String(err)) : String(err) });
            process.exit(1);
        });
}
