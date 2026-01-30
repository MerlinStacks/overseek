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
    return new Date();
}

/**
 * Initialize all available databases
 */
async function loadDatabases(): Promise<void> {
    const newReaders: GeoIPReader[] = [];

    // 1. Try Manual DB
    if (fs.existsSync(MANUAL_DB_PATH)) {
        try {
            const reader = await maxmind.open<CityResponse>(MANUAL_DB_PATH);
            const buildDate = getBuildDate(reader);
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

    readers = newReaders;

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
        const file = fs.createWriteStream(destPath);

        const request = https.get(url, (response) => {
            if (response.statusCode !== 200) {
                fs.unlink(destPath, () => { }); // Delete temp file
                reject(new Error(`Failed to download: Status ${response.statusCode}`));
                return;
            }

            // Pipe response -> gunzip -> file
            const gunzip = zlib.createGunzip();
            response.pipe(gunzip).pipe(file);

            file.on('finish', () => {
                file.close(() => resolve());
            });

            file.on('error', (err) => {
                fs.unlink(destPath, () => { });
                reject(err);
            });

            gunzip.on('error', (err) => {
                fs.unlink(destPath, () => { });
                reject(err);
            });
        });

        request.on('error', (err) => {
            fs.unlink(destPath, () => { });
            reject(err);
        });
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
            const prevDate = new Date();
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
            const testReader = await maxmind.open(tempPath);
            // If we are here, it's valid
            // Check if it's actually newer than what we have? 
            // We can just overwrite. The prioritization logic in loadDatabases will handle it.
            // But good to check if it's valid.

            // Close test reader
            // Note: maxmind library doesn't expose close() easily in types sometimes, strictly it doesn't hold open file handle in pure JS mode but with MMDB-Reader it might.
            // In pure JS mode (default for 'maxmind' package unless using fast version), it reads buffer.

            // Move temp to real path
            fs.renameSync(tempPath, AUTO_DB_PATH);
            Logger.info('[GeoIP] Updated DB-IP database successfully.');

            // Reload databases to pick up potential new order
            await loadDatabases();
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
    updateCheckTimer = setInterval(checkAndRun, MAX_AGE_MS);
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
