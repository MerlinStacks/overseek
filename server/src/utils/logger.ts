import pino from 'pino';


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
// Using pino's built-in stdTimeFunctions.isoTime for proper formatting
const timestampFn = pino.stdTimeFunctions.isoTime;

// Create the raw pino logger for our Logger wrapper
// Note: In Docker containers, pino.destination() can cause buffer interleaving even with
// sync: true. Writing directly to file descriptor 1 (stdout) ensures atomic writes.
const createPinoLogger = () => {
    return pino({
        level,
        customLevels,
        useOnlyCustomLevels: false,
        timestamp: timestampFn,
        // Omit base bindings to reduce log line size and eliminate redundant metadata
        base: undefined,
    });
};

const pinoInstance = createPinoLogger();

// Export the pino instance for direct usage (Logger wrapper)
export const pinoLogger = pinoInstance;

// Fastify 5.x requires a config object, not a Pino instance
// Disable Fastify's internal request logging - we use our own Logger wrapper
// Setting to false disables Fastify's logger entirely (preventing duplicates)
export const fastifyLoggerConfig = false;

/**
 * Serializes Error objects in meta for proper logging.
 * Error properties are non-enumerable, so Pino logs them as {}.
 * This extracts message and stack for visibility.
 */
const serializeMeta = (meta?: Record<string, any>): Record<string, any> | undefined => {
    if (!meta) return undefined;

    const result = { ...meta };

    // Handle 'error' property specifically
    if (result.error instanceof Error) {
        result.error = {
            message: result.error.message,
            stack: result.error.stack,
            name: result.error.name,
            // Preserve any additional properties on the error
            ...(result.error as any)
        };
    }

    // Handle 'err' property (common alternative)
    if (result.err instanceof Error) {
        result.err = {
            message: result.err.message,
            stack: result.err.stack,
            name: result.err.name,
            ...(result.err as any)
        };
    }

    return result;
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
        const serialized = serializeMeta(meta);
        if (serialized) {
            pinoInstance.error(serialized, message);
        } else {
            pinoInstance.error(message);
        }
    },
    warn: (message: string, meta?: Record<string, any>) => {
        const serialized = serializeMeta(meta);
        if (serialized) {
            pinoInstance.warn(serialized, message);
        } else {
            pinoInstance.warn(message);
        }
    },
    info: (message: string, meta?: Record<string, any>) => {
        const serialized = serializeMeta(meta);
        if (serialized) {
            pinoInstance.info(serialized, message);
        } else {
            pinoInstance.info(message);
        }
    },
    http: (message: string, meta?: Record<string, any>) => {
        const serialized = serializeMeta(meta);
        if (serialized) {
            (pinoInstance as any).http(serialized, message);
        } else {
            (pinoInstance as any).http(message);
        }
    },
    debug: (message: string, meta?: Record<string, any>) => {
        const serialized = serializeMeta(meta);
        if (serialized) {
            pinoInstance.debug(serialized, message);
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
