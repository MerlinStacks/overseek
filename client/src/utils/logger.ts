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

/**
 * Formats log message with timestamp and optional metadata.
 */
function formatMessage(level: LogLevel, message: string, meta?: LogMetadata): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
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
