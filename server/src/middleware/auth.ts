import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

interface JwtPayload {
    userId: string;
    iat: number;
    exp: number;
}

export interface AuthRequest extends Request {
    user?: {
        id: string;
        accountId?: string;
        isSuperAdmin?: boolean;
    };
    accountId?: string; // Legacy support
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    // Support query param token for Bull Board (opened in new tab)
    const queryToken = req.query.token as string | undefined;

    let token: string | undefined;

    if (authHeader) {
        token = authHeader.split(' ')[1];
    } else if (queryToken && req.originalUrl.startsWith('/admin/queues')) {
        // Only allow query token for Bull Board route
        token = queryToken;
    }

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = verifyToken(token) as JwtPayload;
        const accountId = req.headers['x-account-id'] as string;

        req.user = {
            id: decoded.userId,
            accountId: accountId
        };

        // Backwards compatibility
        req.accountId = accountId;

        // Strict enforcement for specific routes
        // Strict enforcement for specific routes (Business Logic)
        const STRICT_ACCOUNT_ROUTES = [
            '/customers',
            '/products',
            '/marketing',
            '/orders',
            '/analytics',
            '/woo/configure',
            '/inventory',
            '/invoices',
            '/email',
            '/segments',
            '/audits'
        ];

        const isStrictRoute = STRICT_ACCOUNT_ROUTES.some(route => req.originalUrl.includes(route));

        if (!accountId && isStrictRoute) {
            return res.status(400).json({ error: 'No account selected' });
        }

        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

export const requireSuperAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({ error: 'Authentication required for admin access' });
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user.id }
        });

        if (!user || !user.isSuperAdmin) {
            return res.status(403).json({ error: 'Access denied: Super Admin only' });
        }

        // Attach isSuperAdmin to the request for downstream use if needed
        req.user.isSuperAdmin = true;

        next();
    } catch (error) {
        Logger.error('SuperAdmin check failed', { error });
        res.status(500).json({ error: 'Internal server error during authorization' });
    }
};
