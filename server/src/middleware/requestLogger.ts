/**
 * Request Logger Middleware
 * 
 * Logs all HTTP requests with timing, status, and correlation IDs.
 */

import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger';

/**
 * Request logging middleware with enhanced metadata.
 * 
 * Logs:
 * - Method, URL, status code, duration
 * - Request ID for correlation
 * - IP and User-Agent for errors
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const requestId = req.id || 'unknown';

        const logData = {
            requestId,
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration: `${duration}ms`
        };

        if (res.statusCode >= 500) {
            // Server errors - log with full details
            Logger.error(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`, {
                ...logData,
                ip: req.ip,
                userAgent: req.get('user-agent')
            });
        } else if (res.statusCode >= 400) {
            // Client errors - log as warning
            Logger.warn(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`, {
                ...logData,
                ip: req.ip
            });
        } else if (duration > 5000) {
            // Slow requests - log as warning
            Logger.warn(`Slow request: ${req.method} ${req.originalUrl} ${duration}ms`, logData);
        } else {
            // Normal requests - info level (skip noisy endpoints)
            if (!req.originalUrl.includes('/health')) {
                Logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`, { requestId });
            }
        }
    });

    next();
};
