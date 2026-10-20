import { Client } from '@elastic/elasticsearch';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

export const esClient = new Client({
    node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
    ...(process.env.NODE_ENV !== 'production' ? { tls: { rejectUnauthorized: false } } : {}),
});

/**
 * Lightweight ES availability check with caching.
 * Prevents hundreds of doomed index calls when ES is down (OOM prevention).
 * Result is cached for 60s to avoid spamming ping requests.
 */
let _esAvailable = true;
let _esCheckedAt = -Infinity;
let pendingCheck: Promise<boolean> | null = null;
const ES_CHECK_INTERVAL_MS = 60_000;

export async function isElasticsearchAvailable(): Promise<boolean> {
    const now = Date.now();
    if (now - _esCheckedAt < ES_CHECK_INTERVAL_MS) return _esAvailable;
    if (pendingCheck) return pendingCheck;
    pendingCheck = (async () => {
        try { await esClient.ping({}, { requestTimeout: 5000, maxRetries: 0 }); _esAvailable = true; }
        catch { _esAvailable = false; }
        _esCheckedAt = Date.now();
        return _esAvailable;
    })().finally(() => { pendingCheck = null; });
    return pendingCheck;
}
