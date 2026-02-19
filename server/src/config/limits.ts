/**
 * Centralized Configuration: Limits & Thresholds
 * 
 * Senior Dev Pattern: All magic numbers extracted into named constants
 * for maintainability, documentation, and easy tuning.
 */


export const RATE_LIMITS = {
    /** Maximum requests per window per IP */
    MAX_REQUESTS: 2000,
    /** Time window for rate limiting */
    WINDOW: '15 minutes',
} as const;


export const UPLOAD_LIMITS = {
    /** Maximum file size in bytes (100MB) */
    MAX_FILE_SIZE: 100 * 1024 * 1024,
} as const;


export const AI_LIMITS = {
    /** Maximum tool call iterations to prevent infinite loops */
    MAX_TOOL_ITERATIONS: 5,
    /** Default AI model if not configured */
    DEFAULT_MODEL: 'openai/gpt-4o',
    /** OpenRouter API endpoint */
    API_ENDPOINT: 'https://openrouter.ai/api/v1/chat/completions',
    /** OpenRouter models endpoint */
    MODELS_ENDPOINT: 'https://openrouter.ai/api/v1/models',
    /**
     * Model ID prefixes known to support tool/function calling on OpenRouter.
     * Models outside these prefixes will be called without tool definitions
     * to avoid "No endpoints found that support tool use" 404 errors.
     */
    TOOL_CAPABLE_PREFIXES: [
        'openai/',
        'anthropic/',
        'google/',
        'mistralai/mistral-large',
        'mistralai/mistral-medium',
        'mistralai/mistral-small',
        'cohere/',
        'meta-llama/llama-3',
    ] as readonly string[],
} as const;


export const SCHEDULER_LIMITS = {
    /** Interval for automation ticker in milliseconds (60 seconds) */
    TICKER_INTERVAL_MS: 60_000,
    /** Graceful shutdown timeout in milliseconds */
    SHUTDOWN_TIMEOUT_MS: 10_000,
    /** Fast order sync interval in milliseconds (30 seconds) */
    FAST_SYNC_INTERVAL_MS: 30_000,
    /** Full sync cron pattern (every 5 minutes) */
    FULL_SYNC_CRON: '*/5 * * * *',
    /** Email polling interval in milliseconds (2 minutes) */
    EMAIL_POLL_INTERVAL_MS: 2 * 60_000,
    /** Abandoned cart check interval in milliseconds (15 minutes) */
    ABANDONED_CART_INTERVAL_MS: 15 * 60_000,
    /** Report schedule check interval in milliseconds (15 minutes) */
    REPORT_CHECK_INTERVAL_MS: 15 * 60_000,
} as const;


export const QUEUE_LIMITS = {
    /** Worker concurrency per queue (1 = serialize jobs to cap peak heap usage) */
    WORKER_CONCURRENCY: 1,
    /** Maximum retry attempts for failed jobs */
    MAX_RETRIES: 3,
    /** Retry backoff delay in milliseconds */
    RETRY_DELAY_MS: 2_000,
    /** Keep last N completed jobs per queue */
    COMPLETED_JOBS_KEEP: 100,
    /** Remove failed jobs after N seconds (24 hours) */
    FAILED_JOBS_TTL_SECONDS: 86_400,
    /** Default lock duration in milliseconds (30 seconds) */
    DEFAULT_LOCK_DURATION_MS: 30_000,
    /** Extended lock duration for long-running jobs (5 minutes) */
    LONG_RUNNING_LOCK_DURATION_MS: 300_000,
    /** Stall check interval for long-running jobs (2 minutes) */
    LONG_RUNNING_STALL_INTERVAL_MS: 120_000,
    /** EDGE CASE FIX: Maximum waiting jobs per queue before dropping oldest
     * Prevents OOM when Redis reconnects with large backlog */
    MAX_QUEUE_DEPTH: 500,
} as const;


export const FORECASTING_LIMITS = {
    /** Default number of days to forecast */
    DEFAULT_FORECAST_DAYS: 30,
    /** Days of historical data to use for predictions */
    HISTORICAL_DAYS: 90,
    /** Safety stock multiplier in days */
    SAFETY_STOCK_DAYS: 7,
    /** Default supplier lead time if not specified */
    DEFAULT_LEAD_TIME_DAYS: 14,
} as const;


export const SOCKET_LIMITS = {
    /** Ping timeout in milliseconds */
    PING_TIMEOUT_MS: 60_000,
    /** Ping interval in milliseconds */
    PING_INTERVAL_MS: 25_000,
} as const;


export const HTTP_LIMITS = {
    /** Default API request timeout in milliseconds */
    REQUEST_TIMEOUT_MS: 30_000,
    /** Long-running API request timeout in milliseconds */
    LONG_REQUEST_TIMEOUT_MS: 120_000,
} as const;


export const PAGINATION_LIMITS = {
    /** Default page size for list endpoints */
    DEFAULT_PAGE_SIZE: 20,
    /** Maximum page size for list endpoints */
    MAX_PAGE_SIZE: 100,
} as const;
