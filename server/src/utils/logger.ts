import pino, { DestinationStream } from 'pino';


// Custom levels matching Winston's original config
const customLevels = {
    error: 50,
    warn: 40,
    info: 30,
    http: 25,
    debug: 20,
};

const level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';

// Human-readable timestamp function (ISO format for JSON logs)
const timestampFn = () => `,"time":"${new Date().toISOString()}"`;

// Production: Create a synchronous destination to prevent interleaved output
const productionDestination: DestinationStream = pino.destination({
    dest: 1, // stdout file descriptor
    sync: true, // Synchronous writes to prevent corruption
});

// Create the raw pino logger for our Logger wrapper
const createPinoLogger = () => {
    return pino({
        level,
        customLevels,
        useOnlyCustomLevels: false,
        timestamp: timestampFn,
        // Base bindings for all log entries
        base: {
            pid: process.pid,
            hostname: require('os').hostname(),
        },
    }, productionDestination);
};

const pinoInstance = createPinoLogger();

// Export the pino instance for direct usage (Logger wrapper)
export const pinoLogger = pinoInstance;

// Fastify 5.x requires a config object, not a Pino instance
// Disable Fastify's internal request logging - we use our own Logger wrapper
// Setting to false disables Fastify's logger entirely (preventing duplicates)
export const fastifyLoggerConfig = false;

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
    child: (bindings: Record<string, unknown>) => {
        const childPino = pinoInstance.child(bindings);
        return {
            error: (message: string, meta?: Record<string, unknown>) => meta ? childPino.error(meta, message) : childPino.error(message),
            warn: (message: string, meta?: Record<string, unknown>) => meta ? childPino.warn(meta, message) : childPino.warn(message),
            info: (message: string, meta?: Record<string, unknown>) => meta ? childPino.info(meta, message) : childPino.info(message),
            http: (message: string, meta?: Record<string, any>) => meta ? (childPino as any).http(meta, message) : (childPino as any).http(message),
            debug: (message: string, meta?: Record<string, unknown>) => meta ? childPino.debug(meta, message) : childPino.debug(message),
        };
    },
};
