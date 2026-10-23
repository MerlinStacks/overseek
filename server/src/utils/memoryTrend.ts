export interface MemoryTrendPoint { ts: number; heapUsedMb: number; rssMb: number }

/** Use a complete observation window and increasing low-water marks to avoid
 * mistaking startup/cache warmup or one pre-GC peak for sustained heap growth. */
export function evaluateMemoryTrend(history: readonly MemoryTrendPoint[], windowPoints: number, thresholdMbPerMin: number) {
    const size = Math.max(3, windowPoints);
    if (history.length < size) return null;
    const points = history.slice(-size);
    const first = points[0], last = points[points.length - 1];
    const elapsedMin = (last.ts - first.ts) / 60000;
    if (elapsedMin <= 0) return null;
    const chunk = Math.floor(points.length / 3);
    const low = (rows: readonly MemoryTrendPoint[]) => rows.reduce((a, b) => b.heapUsedMb < a.heapUsedMb ? b : a);
    const lows = [low(points.slice(0, chunk)), low(points.slice(chunk, chunk * 2)), low(points.slice(chunk * 2))];
    const growing = lows.slice(1).every((point, index) => {
        const previous = lows[index], minutes = (point.ts - previous.ts) / 60000;
        return minutes > 0 && (point.heapUsedMb - previous.heapUsedMb) / minutes >= thresholdMbPerMin;
    });
    if (!growing) return null;
    return {
        windowPoints: points.length, elapsedMin: Math.round(elapsedMin * 10) / 10,
        heapSlopeMbPerMin: Math.round((last.heapUsedMb - first.heapUsedMb) / elapsedMin * 100) / 100,
        rssSlopeMbPerMin: Math.round((last.rssMb - first.rssMb) / elapsedMin * 100) / 100,
        heapUsedMbStart: first.heapUsedMb, heapUsedMbEnd: last.heapUsedMb,
        rssMbStart: first.rssMb, rssMbEnd: last.rssMb,
        basis: 'sustained heap low-water growth; not proof of a leak',
    };
}
