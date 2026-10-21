/**
 * GeoIP Service - Modern geolocation using MaxMind GeoLite2 & DB-IP Lite.
 * 
 * Features:
 * - Supports manual MaxMind database uploads (GeoLite2-City.mmdb)
 * - Auto-downloads and updates DB-IP Lite database (dbip-city-lite.mmdb)
 * - Prioritizes the newest database for lookups
 * - Fallback support if one database misses
 */

import path from 'path';
import fs from 'fs';
import https from 'https';
import zlib from 'zlib';
import maxmind, { CityResponse, Reader } from 'maxmind';
import { Logger } from '../../utils/logger';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';

/**
 * Result structure for GeoIP lookups
 */
export interface GeoIPResult {
    country: string | null;
    city: string | null;
    region: string | null;
    timezone: string | null;
    latitude: number | null;
    longitude: number | null;
}

interface GeoIPReader {
    reader: Reader<CityResponse>;
    source: 'manual' | 'auto';
    buildDate: Date;
    path: string;
}

// Database paths
const DATA_DIR = path.join(__dirname, '../../../data');
const MANUAL_DB_PATH = path.join(DATA_DIR, 'GeoLite2-City.mmdb');
const AUTO_DB_PATH = path.join(DATA_DIR, 'dbip-city-lite.mmdb');

// State
let readers: GeoIPReader[] = [];
let initPromise: Promise<void> | null = null;
let updateCheckTimer: NodeJS.Timeout | null = null;
let isUpdating = false;
let readerVersion = 0;
const MAX_DB_BYTES = 128 * 1024 * 1024;

function closeReader(reader: Reader<CityResponse>) { try { (reader as unknown as { close?: () => void }).close?.(); } catch { /* Best-effort release of an old buffer/handle. */ } }
function boundedStream() {
    let bytes = 0;
    return new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > MAX_DB_BYTES ? new Error('GeoIP database exceeds 128 MiB') : null, chunk);
    } });
}
async function installValidatedDatabase(tempPath: string, source: 'manual' | 'auto') {
    const reader = await maxmind.open<CityResponse>(tempPath);
    let installed = false;
    try {
        const buildDate = getBuildDate(reader);
        if (!/city/i.test(reader.metadata.databaseType) || !Number.isFinite(buildDate.getTime())) throw new Error('A valid City MMDB database is required');
        const stats = await fs.promises.stat(tempPath);
        if (!stats.size || stats.size > MAX_DB_BYTES) throw new Error('Invalid GeoIP database size');
        const destination = source === 'manual' ? MANUAL_DB_PATH : AUTO_DB_PATH;
        await fs.promises.rename(tempPath, destination);
        const previous = readers.filter(item => item.source === source);
        readers = [...readers.filter(item => item.source !== source), { reader, source, buildDate, path: destination }].sort((a, b) => b.buildDate.getTime() - a.buildDate.getTime());
        readerVersion++; installed = true;
        previous.forEach(item => closeReader(item.reader));
        return { size: stats.size, lastModified: stats.mtime.toISOString() };
    } finally { if (!installed) closeReader(reader); }
}

/** Shares the update lock with scheduled downloads; invalid uploads never replace the active file. */
export async function installManualGeoIP(stream: Readable, truncated: () => boolean = () => false) {
    if (isUpdating) throw Object.assign(new Error('GeoIP update already in progress'), { statusCode: 409 });
    isUpdating = true;
    const temporary = path.join(DATA_DIR, `.geoip-${randomUUID()}.tmp`);
    try {
        await fs.promises.mkdir(DATA_DIR, { recursive: true });
        await pipeline(stream, boundedStream(), fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal: AbortSignal.timeout(60000) });
        if (truncated()) throw Object.assign(new Error('GeoIP upload was truncated'), { statusCode: 413 });
        return await installValidatedDatabase(temporary, 'manual');
    } finally {
        await fs.promises.unlink(temporary).catch(() => {});
        isUpdating = false;
    }
}

/**
 * Get the build date of a MaxMind reader
 */
function getBuildDate(reader: Reader<CityResponse>): Date {
    const epoch = reader.metadata.buildEpoch;
    if (epoch instanceof Date) {
        return epoch;
    }
    if (typeof epoch === 'number') {
        return new Date(epoch * 1000);
    }
    return new Date(NaN);
}

/**
 * Initialize all available databases
 */
async function loadDatabases(): Promise<void> {
    const version = readerVersion;
    const newReaders: GeoIPReader[] = [];

    // 1. Try Manual DB
    if (fs.existsSync(MANUAL_DB_PATH)) {
        try {
            const reader = await maxmind.open<CityResponse>(MANUAL_DB_PATH);
            const buildDate = getBuildDate(reader);
            if (!/city/i.test(reader.metadata.databaseType) || !Number.isFinite(buildDate.getTime())) { closeReader(reader); throw new Error('Invalid City database metadata'); }
            newReaders.push({
                reader,
                source: 'manual',
                buildDate,
                path: MANUAL_DB_PATH
            });
            Logger.info(`[GeoIP] Loaded manual database (Build: ${buildDate.toISOString().split('T')[0]})`);
        } catch (e: any) {
            Logger.warn(`[GeoIP] Failed to load manual database: ${e.message}`);
        }
    }

    // 2. Try Auto DB
    if (fs.existsSync(AUTO_DB_PATH)) {
        try {
            const reader = await maxmind.open<CityResponse>(AUTO_DB_PATH);
            const buildDate = getBuildDate(reader);
            if (!/city/i.test(reader.metadata.databaseType) || !Number.isFinite(buildDate.getTime())) { closeReader(reader); throw new Error('Invalid City database metadata'); }
            newReaders.push({
                reader,
                source: 'auto',
                buildDate,
                path: AUTO_DB_PATH
            });
            Logger.info(`[GeoIP] Loaded auto database (Build: ${buildDate.toISOString().split('T')[0]})`);
        } catch (e: any) {
            Logger.warn(`[GeoIP] Failed to load auto database: ${e.message}`);
        }
    }

    // 3. Sort by build date (Newest first)
    newReaders.sort((a, b) => b.buildDate.getTime() - a.buildDate.getTime());

    if (readerVersion !== version) { newReaders.forEach(item => closeReader(item.reader)); return; }
    const previous = readers;
    if (newReaders.length || !readers.length) { readers = newReaders; previous.forEach(item => closeReader(item.reader)); }

    if (readers.length === 0) {
        Logger.warn('[GeoIP] No databases available. Lookups will return null.');
    } else {
        Logger.info(`[GeoIP] Active databases: ${readers.map(r => `${r.source} (${r.buildDate.toISOString().split('T')[0]})`).join(', ')}`);
    }
}

/**
 * Download URL helper
 */
function downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { signal: AbortSignal.timeout(60000) }, (response) => {
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Failed to download: Status ${response.statusCode}`));
                return;
            }
            void pipeline(response, zlib.createGunzip(), boundedStream(), fs.createWriteStream(destPath, { mode: 0o600 }), { signal: AbortSignal.timeout(60000) }).then(resolve, reject);
        });
        request.setTimeout(30000, () => request.destroy(new Error('GeoIP download timed out')));
        request.on('error', reject);
    });
}

/**
 * Check for updates from DB-IP
 */
export async function updateGeoLiteDB(): Promise<boolean> {
    if (isUpdating) return false;
    isUpdating = true;

    try {
        const date = new Date();
        const year = date.getFullYear();
        // Pack into 2 digits
        const month = String(date.getMonth() + 1).padStart(2, '0');

        // URL Format: https://download.db-ip.com/free/dbip-city-lite-{YYYY}-{MM}.mmdb.gz
        const filename = `dbip-city-lite-${year}-${month}.mmdb.gz`;
        const url = `https://download.db-ip.com/free/${filename}`;

        Logger.info(`[GeoIP] Checking for updates: ${filename}`);

        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        const tempPath = path.join(DATA_DIR, 'dbip-city-lite.mmdb.tmp'); // Unzipped path
        // We actually download .gz but pipe it through gunzip directly to .mmdb file
        // So we don't save the .gz file to disk, we verify it on the fly basically

        // Try download current month
        try {
            await downloadFile(url, tempPath);
            Logger.info(`[GeoIP] Downloaded ${filename}`);
        } catch (err: any) {
            Logger.warn(`[GeoIP] Could not download current month (${filename}): ${err.message}`);

            // Fallback: Try previous month if current month is "future" or just released and not available yet
            // Or simple logic: if it's early in the month (e.g., < 5th), maybe try prev month?
            // Simplified: If current failed, try 1 month back
            const prevDate = new Date(); prevDate.setDate(1);
            prevDate.setMonth(prevDate.getMonth() - 1);
            const prevYear = prevDate.getFullYear();
            const prevMonth = String(prevDate.getMonth() + 1).padStart(2, '0');
            const prevFilename = `dbip-city-lite-${prevYear}-${prevMonth}.mmdb.gz`;
            const prevUrl = `https://download.db-ip.com/free/${prevFilename}`;

            Logger.info(`[GeoIP] Trying fallback: ${prevFilename}`);
            await downloadFile(prevUrl, tempPath);
            Logger.info(`[GeoIP] Downloaded fallback ${prevFilename}`);
        }

        // Test the new database before swapping
        try {
            await installValidatedDatabase(tempPath, 'auto');
            Logger.info('[GeoIP] Updated DB-IP database successfully.');
            return true;
        } catch (e: any) {
            Logger.error(`[GeoIP] Downloaded database is invalid: ${e.message}`);
            fs.unlink(tempPath, () => { }); // Cleanup
            return false;
        }

    } catch (e: any) {
        Logger.error(`[GeoIP] Update failed: ${e.message}`);
        return false;
    } finally {
        await fs.promises.unlink(path.join(DATA_DIR, 'dbip-city-lite.mmdb.tmp')).catch(() => {});
        isUpdating = false;
    }
}

/**
 * Schedule regular updates
 */
export function scheduleUpdates() {
    // Check immediately on startup (if no auto db exists or it's old)
    // Actually, just check. The updateDB method handles "download if URL works".
    // We should be careful not to spam.
    // Let's check if the file exists and how old it is.

    // Initial check (non-blocking)
    const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

    const checkAndRun = async () => {
        let shouldUpdate = false;

        if (!fs.existsSync(AUTO_DB_PATH)) {
            shouldUpdate = true;
        } else {
            const stats = fs.statSync(AUTO_DB_PATH);
            const age = Date.now() - stats.mtimeMs;
            if (age > MAX_AGE_MS) {
                shouldUpdate = true;
            }
        }

        if (shouldUpdate) {
            Logger.info('[GeoIP] Auto database missing or old, starting update...');
            await updateGeoLiteDB();
        }
    };

    // Run initial check
    checkAndRun().catch(e => Logger.error('[GeoIP] Initial update check failed', { error: e }));

    // Schedule weekly check
    if (updateCheckTimer) clearInterval(updateCheckTimer);
    updateCheckTimer = setInterval(() => { void checkAndRun().catch(error => Logger.error('[GeoIP] Scheduled update failed', { error })); }, MAX_AGE_MS);
    updateCheckTimer.unref();
}

/**
 * Perform a GeoIP lookup for the given IP address.
 */
export async function geoipLookup(ipAddress: string): Promise<GeoIPResult | null> {
    if (!initPromise) initPromise = loadDatabases();
    await initPromise;
    return geoipLookupSync(ipAddress);
}

/**
 * Synchronous lookup wrapper
 */
export function geoipLookupSync(ipAddress: string): GeoIPResult | null {
    if (readers.length === 0) {
        if (!initPromise) initPromise = loadDatabases();
        return null; // Async load triggered
    }

    // Iterate through readers (sorted by newest first)
    for (const { reader } of readers) {
        try {
            const result = reader.get(ipAddress);
            if (result) {
                return {
                    country: result.country?.iso_code || null,
                    city: result.city?.names?.en || null,
                    region: result.subdivisions?.[0]?.iso_code || null,
                    timezone: result.location?.time_zone || null,
                    latitude: result.location?.latitude || null,
                    longitude: result.location?.longitude || null
                };
            }
        } catch (e) {
            // Ignore error and try next reader
            continue;
        }
    }

    return null;
}

/**
 * Get status of all databases
 */
export function getDatabaseStatus() {
    return readers.map(r => ({
        source: r.source,
        buildDate: r.buildDate,
        path: r.path,
        dbType: 'City', // Assuming City for now
        size: fs.existsSync(r.path) ? fs.statSync(r.path).size : 0
    }));
}

/**
 * Pre-initialize the GeoIP reader at server startup.
 */
export async function initGeoIP(forceReload: boolean = false): Promise<void> {
    if (forceReload || !initPromise) {
        initPromise = loadDatabases();
    }
    await initPromise;

    // Also start the scheduler
    scheduleUpdates();
}
