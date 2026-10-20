/**
 * Client-side Logger utility
 * Provides structured logging with levels and optional metadata.
 * In production, logs are suppressed except for errors and warnings.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogMetadata {
    [key: string]: unknown;
}

const isDev = import.meta.env.DEV;

/** Logging must not replace the original failure with a serialization error. */
function serializeMetadata(meta: LogMetadata): string {
    const ancestors: object[] = [];
    const errors = new WeakMap<Error, object>();
    try {
        return JSON.stringify(meta, function (_key, value: unknown) {
            if (typeof value === 'bigint') return value.toString();
            if (value instanceof Error) {
                let details = errors.get(value);
                if (!details) {
                    details = { ...value, name: value.name, message: value.message, stack: value.stack, cause: value.cause };
                    errors.set(value, details);
                }
                value = details;
            }
            if (value !== null && typeof value === 'object') {
                // Track ancestors, not every visited object: shared references are not cycles.
                while (ancestors.length && ancestors[ancestors.length - 1] !== this) ancestors.pop();
                if (ancestors.includes(value)) return '[Circular]';
                ancestors.push(value);
            }
            return value;
        }) ?? '"[Unserializable metadata]"';
    } catch {
        // Getters, proxies and custom toJSON methods may themselves throw.
        return '"[Unserializable metadata]"';
    }
}

/**
 * Formats log message with timestamp and optional metadata.
 */
function formatMessage(level: LogLevel, message: string, meta?: LogMetadata): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${serializeMetadata(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

export const Logger = {
    /**
     * Debug level - only shown in development
     */
    debug(message: string, meta?: LogMetadata): void {
        if (isDev) {
            console.debug(formatMessage('debug', message, meta));
        }
    },

    /**
     * Info level - only shown in development
     */
    info(message: string, meta?: LogMetadata): void {
        if (isDev) {
            console.info(formatMessage('info', message, meta));
        }
    },

    /**
     * Warning level - always shown
     */
    warn(message: string, meta?: LogMetadata): void {
        console.warn(formatMessage('warn', message, meta));
    },

    /**
     * Error level - always shown, includes stack trace
     */
    error(message: string, meta?: LogMetadata): void {
        console.error(formatMessage('error', message, meta));
    }
};
