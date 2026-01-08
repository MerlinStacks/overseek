/**
 * Request ID Middleware
 * 
 * Adds correlation IDs to requests for tracing across logs.
 * IDs are passed through to responses and available in req.id.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            /** Unique request correlation ID */
            id: string;
        }
    }
}

/**
 * Generates a unique request ID.
 * Uses crypto.randomUUID for high-quality random IDs.
 */
function generateRequestId(): string {
    return crypto.randomUUID();
}

/**
 * Request ID middleware.
 * 
 * - Checks for existing X-Request-ID header (from load balancer)
 * - Generates new ID if not present
 * - Attaches to request and response headers
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
    // Use existing header if provided (e.g., from nginx/load balancer)
    const existingId = req.headers['x-request-id'];
    const id = typeof existingId === 'string' ? existingId : generateRequestId();

    // Attach to request object
    req.id = id;

    // Send in response headers for client-side correlation
    res.setHeader('X-Request-ID', id);

    next();
}

/**
 * Gets the current request ID from the request object.
 * Returns 'unknown' if not available.
 */
export function getRequestId(req: Request): string {
    return req.id || 'unknown';
}
