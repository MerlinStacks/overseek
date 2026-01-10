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
    // Always use JSON output (best for Prod & Dev via pipe)
    // Synchronous writing avoids buffer interleaving issues
    return pino({
        level,
        customLevels,
        useOnlyCustomLevels: false,
        // Remove 'transport' entirely - let the shell handle pretty printing
    }, productionDestination);
};

const pinoInstance = createPinoLogger();

// Export the pino instance for direct usage (Logger wrapper)
export const pinoLogger = pinoInstance;

// Export Fastify-compatible logger config
export const fastifyLoggerConfig = {
    level,
    customLevels, // Pass custom levels to Fastify so it knows about them
    useOnlyCustomLevels: false,
    // No transport here either
};

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
