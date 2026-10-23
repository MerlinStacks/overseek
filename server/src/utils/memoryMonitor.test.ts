import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), alert: vi.fn(), heap: 130.7 }));
vi.mock('./logger', () => ({ Logger: { info: m.info, warn: m.warn, error: vi.fn() } }));
vi.mock('./runtimeMetrics', () => ({ getRuntimeMetricsSnapshot: () => ({}) }));
vi.mock('../services/OperationalAlertService', () => ({ sendOperationalAlert: m.alert }));
vi.mock('v8', () => ({ default: { getHeapStatistics: () => ({ heap_size_limit: 1000 * 1024 * 1024 }), writeHeapSnapshot: vi.fn() } }));
import { startMemoryMonitor, stopMemoryMonitor } from './memoryMonitor';
beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks(); m.heap = 130.7;
    vi.stubEnv('MEMORY_MONITOR_ENABLED', 'true'); vi.stubEnv('MEMORY_MONITOR_INTERVAL_MS', '300000');
    vi.stubEnv('MEMORY_MONITOR_LOG_LEVEL', 'info'); vi.stubEnv('MEMORY_MONITOR_HEAPDUMP_ENABLED', 'false');
    vi.stubEnv('MEMORY_MONITOR_TREND_WINDOW_POINTS', '3'); vi.stubEnv('MEMORY_MONITOR_WARN_HEAP_PCT', '80');
    vi.spyOn(process, 'memoryUsage').mockImplementation(() => ({ rss: (m.heap + 400) * 1024 * 1024, heapUsed: m.heap * 1024 * 1024, heapTotal: 900 * 1024 * 1024, external: 0, arrayBuffers: 0 }));
});
afterEach(() => { stopMemoryMonitor(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });
it('does not emit a leak warning for the reported startup increase followed by a GC decrease', async () => {
    startMemoryMonitor(); m.heap = 260.1; await vi.advanceTimersByTimeAsync(300000);
    m.heap = 221.5; await vi.advanceTimersByTimeAsync(300000);
    expect(m.warn).not.toHaveBeenCalled(); expect(m.alert).not.toHaveBeenCalled();
});
it('still alerts immediately on genuine high heap pressure without waiting for a trend window', () => {
    m.heap = 850; startMemoryMonitor();
    expect(m.warn).toHaveBeenCalledWith('[MemoryMonitor] High heap usage detected', expect.objectContaining({ heapUsedPct: 85 }));
    expect(m.alert).toHaveBeenCalledWith(expect.objectContaining({ category: 'memory', fingerprint: 'memory:high-heap-usage' }));
});
