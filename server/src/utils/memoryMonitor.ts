import fs from 'fs';
import os from 'os';
import path from 'path';
import v8 from 'v8';
import { monitorEventLoopDelay } from 'perf_hooks';
import { Logger } from './logger';
import { getRuntimeMetricsSnapshot } from './runtimeMetrics';

let monitorInterval: NodeJS.Timeout | null = null;
let latestSnapshot: MemorySnapshot | null = null;
let eventLoopDelayHistogram: ReturnType<typeof monitorEventLoopDelay> | null = null;
let lastHeapdumpAtMs = 0;
const heapHistory: Array<{ ts: number; heapUsedMb: number; rssMb: number }> = [];

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_WARN_HEAP_PCT = 80;
const DEFAULT_SNAPSHOT_LOG_LEVEL: 'info' | 'warn' = 'warn';
const DEFAULT_TREND_WINDOW_POINTS = 12;
const DEFAULT_TREND_WARN_MB_PER_MIN = 8;
const DEFAULT_HEAPDUMP_PCT = 92;
const DEFAULT_HEAPDUMP_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_HEAPDUMP_DIR = path.join(os.tmpdir(), 'overseek-heapdumps');

export interface MemorySnapshot {
    timestamp: string;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    heapLimitMb: number;
    heapUsedPct: number;
    externalMb: number;
    arrayBuffersMb: number;
    nodeMaxOldSpaceSizeMb: number | null;
    eventLoopLagP95Ms: number;
    eventLoopLagMeanMs: number;
    eventLoopLagMaxMs: number;
    runtimeMetrics: Record<string, unknown>;
}

function toMegabytes(bytes: number): number {
    return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function parsePositiveInt(value: string | undefined, fallback: number, envName: string): number {
    if (!value) return fallback;

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        Logger.warn('[MemoryMonitor] Invalid env value, using fallback', {
            envName,
            value,
            fallback
        });
        return fallback;
    }

    return Math.floor(parsed);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    const normalized = value.trim().toLowerCase();
    return !['0', 'false', 'off', 'no'].includes(normalized);
}

function isEnabled(): boolean {
    return parseBoolean(process.env.MEMORY_MONITOR_ENABLED, true);
}

function getNodeMaxOldSpaceSizeMb(): number | null {
    const options = process.env.NODE_OPTIONS || '';
    const match = options.match(/--max-old-space-size=(\d+)/);
    if (!match) return null;

    const parsed = Number(match[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getSnapshotLogLevel(): 'info' | 'warn' {
    const raw = (process.env.MEMORY_MONITOR_LOG_LEVEL || '').trim().toLowerCase();
    if (raw === 'info') return 'info';
    if (raw === 'warn') return 'warn';
    return DEFAULT_SNAPSHOT_LOG_LEVEL;
}

function getEventLoopStats() {
    if (!eventLoopDelayHistogram) {
        return {
            eventLoopLagP95Ms: 0,
            eventLoopLagMeanMs: 0,
            eventLoopLagMaxMs: 0,
        };
    }

    const p95Ns = eventLoopDelayHistogram.percentile(95);
    const meanNs = eventLoopDelayHistogram.mean;
    const maxNs = eventLoopDelayHistogram.max;

    // Reset after each snapshot so values represent the latest interval.
    eventLoopDelayHistogram.reset();

    return {
        eventLoopLagP95Ms: Number.isFinite(p95Ns) ? Math.round((p95Ns / 1_000_000) * 100) / 100 : 0,
        eventLoopLagMeanMs: Number.isFinite(meanNs) ? Math.round((meanNs / 1_000_000) * 100) / 100 : 0,
        eventLoopLagMaxMs: Number.isFinite(maxNs) ? Math.round((maxNs / 1_000_000) * 100) / 100 : 0,
    };
}

function buildSnapshot(): MemorySnapshot {
    const usage = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();

    return {
        timestamp: new Date().toISOString(),
        rssMb: toMegabytes(usage.rss),
        heapUsedMb: toMegabytes(usage.heapUsed),
        heapTotalMb: toMegabytes(usage.heapTotal),
        heapLimitMb: toMegabytes(heapStats.heap_size_limit),
        heapUsedPct: heapStats.heap_size_limit > 0
            ? Math.round((usage.heapUsed / heapStats.heap_size_limit) * 1000) / 10
            : 0,
        externalMb: toMegabytes(usage.external),
        arrayBuffersMb: toMegabytes(usage.arrayBuffers),
        nodeMaxOldSpaceSizeMb: getNodeMaxOldSpaceSizeMb(),
        ...getEventLoopStats(),
        runtimeMetrics: getRuntimeMetricsSnapshot(),
    };
}

function maybeWarnTrend(snapshot: MemorySnapshot): void {
    const windowPoints = parsePositiveInt(
        process.env.MEMORY_MONITOR_TREND_WINDOW_POINTS,
        DEFAULT_TREND_WINDOW_POINTS,
        'MEMORY_MONITOR_TREND_WINDOW_POINTS'
    );
    const trendWarnMbPerMin = parsePositiveInt(
        process.env.MEMORY_MONITOR_TREND_WARN_MB_PER_MIN,
        DEFAULT_TREND_WARN_MB_PER_MIN,
        'MEMORY_MONITOR_TREND_WARN_MB_PER_MIN'
    );

    heapHistory.push({
        ts: Date.now(),
        heapUsedMb: snapshot.heapUsedMb,
        rssMb: snapshot.rssMb,
    });
    while (heapHistory.length > windowPoints) heapHistory.shift();

    if (heapHistory.length < 3) return;

    const first = heapHistory[0];
    const last = heapHistory[heapHistory.length - 1];
    const elapsedMin = (last.ts - first.ts) / 60_000;
    if (elapsedMin <= 0) return;

    const heapSlope = (last.heapUsedMb - first.heapUsedMb) / elapsedMin;
    const rssSlope = (last.rssMb - first.rssMb) / elapsedMin;

    if (heapSlope >= trendWarnMbPerMin) {
        Logger.warn('[MemoryMonitor] Potential memory leak trend detected', {
            windowPoints: heapHistory.length,
            elapsedMin: Math.round(elapsedMin * 10) / 10,
            heapSlopeMbPerMin: Math.round(heapSlope * 100) / 100,
            rssSlopeMbPerMin: Math.round(rssSlope * 100) / 100,
            heapUsedMbStart: first.heapUsedMb,
            heapUsedMbEnd: last.heapUsedMb,
            rssMbStart: first.rssMb,
            rssMbEnd: last.rssMb,
        });
    }
}

function maybeWriteHeapdump(snapshot: MemorySnapshot): void {
    const heapdumpEnabled = parseBoolean(process.env.MEMORY_MONITOR_HEAPDUMP_ENABLED, true);
    if (!heapdumpEnabled) return;

    const thresholdPct = parsePositiveInt(
        process.env.MEMORY_MONITOR_HEAPDUMP_PCT,
        DEFAULT_HEAPDUMP_PCT,
        'MEMORY_MONITOR_HEAPDUMP_PCT'
    );
    if (snapshot.heapUsedPct < thresholdPct) return;

    const cooldownMs = parsePositiveInt(
        process.env.MEMORY_MONITOR_HEAPDUMP_COOLDOWN_MS,
        DEFAULT_HEAPDUMP_COOLDOWN_MS,
        'MEMORY_MONITOR_HEAPDUMP_COOLDOWN_MS'
    );
    const now = Date.now();
    if (now - lastHeapdumpAtMs < cooldownMs) return;

    const dumpDir = process.env.MEMORY_MONITOR_HEAPDUMP_DIR || DEFAULT_HEAPDUMP_DIR;
    try {
        fs.mkdirSync(dumpDir, { recursive: true });
        const safeTs = snapshot.timestamp.replace(/[:.]/g, '-');
        const filename = `heap-${safeTs}-${Math.round(snapshot.heapUsedPct)}pct.heapsnapshot`;
        const filePath = path.join(dumpDir, filename);
        v8.writeHeapSnapshot(filePath);
        lastHeapdumpAtMs = now;

        Logger.warn('[MemoryMonitor] Heap snapshot written', {
            filePath,
            heapUsedPct: snapshot.heapUsedPct,
            thresholdPct,
            cooldownMs,
        });
    } catch (error) {
        Logger.error('[MemoryMonitor] Failed to write heap snapshot', { error });
    }
}

function logSnapshot(warnHeapPct: number, snapshotLogLevel: 'info' | 'warn'): void {
    const snapshot = buildSnapshot();
    latestSnapshot = snapshot;

    maybeWarnTrend(snapshot);
    maybeWriteHeapdump(snapshot);

    const meta = { ...snapshot };
    if (snapshot.heapUsedPct >= warnHeapPct) {
        Logger.warn('[MemoryMonitor] High heap usage detected', meta);
        return;
    }

    if (snapshotLogLevel === 'warn') {
        Logger.warn('[MemoryMonitor] Snapshot', meta);
    } else {
        Logger.info('[MemoryMonitor] Snapshot', meta);
    }
}

export function startMemoryMonitor(): void {
    if (!isEnabled()) {
        Logger.info('[MemoryMonitor] Disabled (MEMORY_MONITOR_ENABLED=false)');
        return;
    }

    if (monitorInterval) return;

    const intervalMs = parsePositiveInt(
        process.env.MEMORY_MONITOR_INTERVAL_MS,
        DEFAULT_INTERVAL_MS,
        'MEMORY_MONITOR_INTERVAL_MS'
    );
    const warnHeapPct = parsePositiveInt(
        process.env.MEMORY_MONITOR_WARN_HEAP_PCT,
        DEFAULT_WARN_HEAP_PCT,
        'MEMORY_MONITOR_WARN_HEAP_PCT'
    );
    const snapshotLogLevel = getSnapshotLogLevel();

    eventLoopDelayHistogram = monitorEventLoopDelay({ resolution: 20 });
    eventLoopDelayHistogram.enable();

    const startupMeta = {
        intervalMs,
        warnHeapPct,
        snapshotLogLevel,
        nodeMaxOldSpaceSizeMb: getNodeMaxOldSpaceSizeMb(),
    };

    if (snapshotLogLevel === 'warn') {
        Logger.warn('[MemoryMonitor] Started', startupMeta);
    } else {
        Logger.info('[MemoryMonitor] Started', startupMeta);
    }

    logSnapshot(warnHeapPct, snapshotLogLevel);
    monitorInterval = setInterval(() => logSnapshot(warnHeapPct, snapshotLogLevel), intervalMs);
    monitorInterval.unref?.();
}

export function getLatestMemorySnapshot(): MemorySnapshot {
    // Return cached snapshot for continuity, but ensure callers always get data.
    if (latestSnapshot) return latestSnapshot;

    const snapshot = buildSnapshot();
    latestSnapshot = snapshot;
    return snapshot;
}

export function stopMemoryMonitor(): void {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }

    if (eventLoopDelayHistogram) {
        eventLoopDelayHistogram.disable();
        eventLoopDelayHistogram = null;
    }

    Logger.info('[MemoryMonitor] Stopped');
}
