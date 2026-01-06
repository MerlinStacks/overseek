import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { SearchQueryService } from '../services/search/SearchQueryService';
import { EmbeddingService } from '../services/EmbeddingService';
import { requireAuth } from '../middleware/auth';
import { Logger } from '../utils/logger';

const router = Router();

router.use(requireAuth);

router.get('/global', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = req.accountId;
        const { q } = req.query;

        if (!accountId) return res.status(400).json({ error: 'No account' });

        const results = await SearchQueryService.globalSearch(accountId, q as string);
        res.json(results);
    } catch (error) {
        Logger.error('Search failed', { error });
        res.status(500).json({ error: 'Search failed' });
    }
});

// Semantic search using pgvector embeddings
router.get('/semantic', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = req.accountId;
        const { q, limit } = req.query;

        if (!accountId) return res.status(400).json({ error: 'No account' });
        if (!q) return res.status(400).json({ error: 'Query required' });

        const results = await EmbeddingService.semanticSearch(
            accountId,
            q as string,
            parseInt(limit as string) || 10
        );

        res.json(results);
    } catch (error) {
        Logger.error('Semantic search failed', { error });
        res.status(500).json({ error: 'Semantic search failed' });
    }
});

// Find similar products
router.get('/similar/:productId', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = req.accountId;
        const { productId } = req.params;
        const { limit } = req.query;

        if (!accountId) return res.status(400).json({ error: 'No account' });

        const results = await EmbeddingService.findSimilarProducts(
            productId,
            accountId,
            parseInt(limit as string) || 5
        );

        res.json(results);
    } catch (error) {
        Logger.error('Similar products search failed', { error });
        res.status(500).json({ error: 'Similar products search failed' });
    }
});

// Batch generate embeddings (admin only)
router.post('/embeddings/generate', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = req.accountId;
        const { limit } = req.body;

        if (!accountId) return res.status(400).json({ error: 'No account' });

        const updated = await EmbeddingService.batchUpdateEmbeddings(
            accountId,
            limit || 100
        );

        res.json({ success: true, updated });
    } catch (error) {
        Logger.error('Embedding generation failed', { error });
        res.status(500).json({ error: 'Embedding generation failed' });
    }
});

export default router;
