import pino from 'pino';



const customLevels = {
    error: 50,
    warn: 40,
    info: 30,
    http: 25,
    debug: 20,
};

const level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';


const timestampFn = pino.stdTimeFunctions.isoTime;

// write to fd 1 directly — pino.destination() can interleave in Docker even with sync: true
const createPinoLogger = () => {
    return pino({
        level,
        customLevels,
        useOnlyCustomLevels: false,
        timestamp: timestampFn,
        base: undefined, // skip hostname/pid noise
    });
};

const pinoInstance = createPinoLogger();


export const pinoLogger = pinoInstance;

// disable fastify's built-in logger — we use our own wrapper
export const fastifyLoggerConfig = false;

/** Error props are non-enumerable so pino logs them as {}. This extracts message/stack. */
const serializeMeta = (meta?: Record<string, any>): Record<string, any> | undefined => {
    if (!meta) return undefined;

    const result = { ...meta };


    if (result.error instanceof Error) {
        result.error = {
            message: result.error.message,
            stack: result.error.stack,
            name: result.error.name,

            ...(result.error as any)
        };
    }


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

/** winston-style Logger.info('msg', { meta }) → pino's .info({ meta }, 'msg') */
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
