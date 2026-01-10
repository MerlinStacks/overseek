import pino, { DestinationStream } from 'pino';
import fs from 'fs';
import path from 'path';

// Custom levels matching Winston's original config
const customLevels = {
    error: 50,
    warn: 40,
    info: 30,
    http: 25,
    debug: 20,
};

const level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';
const isDev = process.env.NODE_ENV === 'development';

// Production: Create a synchronous destination to prevent interleaved output
const productionDestination: DestinationStream = pino.destination({
    dest: 1, // stdout file descriptor
    sync: true, // Synchronous writes to prevent corruption
});

// Create the raw pino logger
const createPinoLogger = () => {
    if (isDev) {
        // Development: Use pino-pretty for colored console output
        return pino({
            level,
            customLevels,
            useOnlyCustomLevels: false,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'yyyy-mm-dd HH:MM:ss:l',
                    ignore: 'pid,hostname',
                },
            },
        });
    }

    // Production: Synchronous JSON output to prevent corruption
    // Using sync destination ensures logs don't interleave when multiple
    // async operations write simultaneously
    return pino({
        level,
        customLevels,
        useOnlyCustomLevels: false,
    }, productionDestination);
};

const pinoInstance = createPinoLogger();

// Export the pino instance for direct usage (Logger wrapper)
export const pinoLogger = pinoInstance;

// Export Fastify-compatible logger config (Fastify 5.x requires a config object, not an instance)
// In production, we pass the SAME pino instance to Fastify to avoid duplicate loggers
export const fastifyLoggerConfig = isDev
    ? {
        level,
        customLevels,
        useOnlyCustomLevels: false,
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'yyyy-mm-dd HH:MM:ss:l',
                ignore: 'pid,hostname',
            },
        },
    }
    : pinoInstance; // In production, share the same logger instance to prevent duplicate output

/**
 * Winston-compatible Logger wrapper.
 * 
 * Winston API: Logger.info('message', { meta })
 * Pino API:    Logger.info({ meta }, 'message')
 * 
 * This wrapper adapts Winston-style calls to Pino's API.
 */
export const Logger = {
    error: (message: string, meta?: Record<string, any>) => {
        if (meta) {
            pinoInstance.error(meta, message);
        } else {
            pinoInstance.error(message);
        }
    },
    warn: (message: string, meta?: Record<string, any>) => {
        if (meta) {
            pinoInstance.warn(meta, message);
        } else {
            pinoInstance.warn(message);
        }
    },
    info: (message: string, meta?: Record<string, any>) => {
        if (meta) {
            pinoInstance.info(meta, message);
        } else {
            pinoInstance.info(message);
        }
    },
    http: (message: string, meta?: Record<string, any>) => {
        if (meta) {
            (pinoInstance as any).http(meta, message);
        } else {
            (pinoInstance as any).http(message);
        }
    },
    debug: (message: string, meta?: Record<string, any>) => {
        if (meta) {
            pinoInstance.debug(meta, message);
        } else {
            pinoInstance.debug(message);
        }
    },
    // Child logger support for contextual logging
    child: (bindings: Record<string, any>) => {
        const childPino = pinoInstance.child(bindings);
        return {
            error: (message: string, meta?: Record<string, any>) => meta ? childPino.error(meta, message) : childPino.error(message),
            warn: (message: string, meta?: Record<string, any>) => meta ? childPino.warn(meta, message) : childPino.warn(message),
            info: (message: string, meta?: Record<string, any>) => meta ? childPino.info(meta, message) : childPino.info(message),
            http: (message: string, meta?: Record<string, any>) => meta ? (childPino as any).http(meta, message) : (childPino as any).http(message),
            debug: (message: string, meta?: Record<string, any>) => meta ? childPino.debug(meta, message) : childPino.debug(message),
        };
    },
};
