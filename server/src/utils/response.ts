/**
 * API Response Helpers
 * 
 * Standardized response utilities for consistent API responses.
 */

import { Response } from 'express';
import { Logger } from './logger';

/**
 * Success response with data.
 */
export function successResponse<T>(res: Response, data: T, statusCode = 200): Response {
    return res.status(statusCode).json(data);
}

/**
 * Created response (201).
 */
export function createdResponse<T>(res: Response, data: T): Response {
    return res.status(201).json(data);
}

/**
 * Error response with logging.
 * @param context - Error context for logging (e.g., 'User Login Failed')
 */
export function errorResponse(
    res: Response,
    error: any,
    context: string,
    statusCode = 500
): Response {
    Logger.error(context, { error: error?.message || error });
    return res.status(statusCode).json({
        error: statusCode < 500 ? error?.message || 'Request failed' : 'Internal server error'
    });
}

/**
 * Validation error response (400).
 */
export function validationError(res: Response, message: string): Response {
    return res.status(400).json({ error: message });
}

/**
 * Not found response (404).
 */
export function notFoundResponse(res: Response, resource = 'Resource'): Response {
    return res.status(404).json({ error: `${resource} not found` });
}

/**
 * Unauthorized response (401).
 */
export function unauthorizedResponse(res: Response, message = 'Unauthorized'): Response {
    return res.status(401).json({ error: message });
}

/**
 * Forbidden response (403).
 */
export function forbiddenResponse(res: Response, message = 'Forbidden'): Response {
    return res.status(403).json({ error: message });
}
