import { describe, expect, it, vi } from 'vitest';
import { loadCollections, seedHelpContent } from './seedHelpContent';
const input = [{ title: 'Help', slug: 'help', order: 0, articles: [{ title: 'Article', slug: 'article', content: 'Content', order: 0 }] }];
describe('explicit, non-destructive help seeding', () => {
    it('loads the actual repository getter without opening database clients', async () => { expect(Array.isArray(await loadCollections())).toBe(true); });
    it('never writes in dry-run and preserves existing articles by default', async () => {
        const db = { helpCollection: { findUnique: vi.fn().mockResolvedValue({ id: 'collection' }), upsert: vi.fn() }, helpArticle: { findUnique: vi.fn().mockResolvedValue({ id: 'article' }), upsert: vi.fn() } };
        expect(await seedHelpContent(input, { apply: false, overwrite: false, publish: false }, db as any)).toMatchObject({ preserved: 2, dryRun: true }); expect(db.helpArticle.upsert).not.toHaveBeenCalled();
    });
    it('requires explicit overwrite/publication and uses one transaction for applied content', async () => {
        const tx = { helpCollection: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ id: 'collection' }) }, helpArticle: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() } }; const transaction = vi.fn(task => task(tx));
        await seedHelpContent(input, { apply: true, overwrite: false, publish: false }, { $transaction: transaction } as any); expect(transaction).toHaveBeenCalledOnce(); expect(tx.helpArticle.upsert.mock.calls[0][0].create.isPublished).toBe(false);
    });
});
