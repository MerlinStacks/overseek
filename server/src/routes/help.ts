import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';

const router = Router();

// PUBLIC READ ROUTES

// Get all collections with articles
router.get('/collections', async (req: Request, res: Response) => {
    try {
        const collections = await prisma.helpCollection.findMany({
            include: {
                articles: {
                    select: { id: true, title: true, slug: true, excerpt: true, order: true },
                    where: { isPublished: true },
                    orderBy: { order: 'asc' }
                }
            },
            orderBy: { order: 'asc' }
        });
        res.json(collections);
    } catch (error) {
        Logger.error('Get Help Collections error', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Search Articles
router.get('/search', async (req: Request, res: Response) => {
    try {
        const { q } = req.query;
        if (!q || typeof q !== 'string') return res.json([]);

        const articles = await prisma.helpArticle.findMany({
            where: {
                isPublished: true,
                OR: [
                    { title: { contains: q, mode: 'insensitive' } },
                    { content: { contains: q, mode: 'insensitive' } },
                    { excerpt: { contains: q, mode: 'insensitive' } }
                ]
            },
            select: {
                id: true,
                title: true,
                slug: true,
                excerpt: true,
                collection: { select: { title: true, slug: true } }
            },
            take: 10
        });

        res.json(articles);
    } catch (error) {
        Logger.error('Search Help error', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get single article
router.get('/articles/:slug', async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;
        const article = await prisma.helpArticle.findUnique({
            where: { slug },
            include: {
                collection: {
                    select: { id: true, title: true, slug: true }
                }
            }
        });

        if (!article) return res.status(404).json({ error: 'Article not found' });
        if (!article.isPublished) {
            // Logic to allow admin preview could go here
            return res.status(404).json({ error: 'Article not found' });
        }

        // Increment view count
        prisma.helpArticle.update({
            where: { id: article.id },
            data: { viewCount: { increment: 1 } }
        }).catch(err => Logger.error('Failed to update view count', { error: err }));

        res.json(article);
    } catch (error) {
        Logger.error('Get Article error', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
});


// ADMIN WRITE ROUTES

router.post('/collections', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
        const { title, slug, description, icon, order } = req.body;
        const collection = await prisma.helpCollection.create({
            data: { title, slug, description, icon, order: order || 0 }
        });
        res.json(collection);
    } catch (e) {
        Logger.error('Create collection error', { error: e });
        res.status(500).json({ error: 'Failed to create collection' });
    }
});

router.put('/collections/:id', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { title, slug, description, icon, order } = req.body;
        const collection = await prisma.helpCollection.update({
            where: { id },
            data: { title, slug, description, icon, order }
        });
        res.json(collection);
    } catch (e) {
        res.status(500).json({ error: 'Failed to update collection' });
    }
});

router.delete('/collections/:id', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await prisma.helpCollection.delete({ where: { id } });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete collection' });
    }
});

router.post('/articles', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
        const { collectionId, title, slug, content, excerpt, isPublished, order } = req.body;
        const article = await prisma.helpArticle.create({
            data: { collectionId, title, slug, content, excerpt, isPublished: isPublished ?? true, order: order || 0 }
        });
        res.json(article);
    } catch (e) {
        Logger.error('Create article error', { error: e });
        res.status(500).json({ error: 'Failed to create article' });
    }
});

router.put('/articles/:id', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { collectionId, title, slug, content, excerpt, isPublished, order } = req.body;
        const article = await prisma.helpArticle.update({
            where: { id },
            data: { collectionId, title, slug, content, excerpt, isPublished, order }
        });
        res.json(article);
    } catch (e) {
        res.status(500).json({ error: 'Failed to update article' });
    }
});

router.delete('/articles/:id', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await prisma.helpArticle.delete({ where: { id } });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete article' });
    }
});

export default router;
