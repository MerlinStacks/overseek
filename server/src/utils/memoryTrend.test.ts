import { expect, it } from 'vitest';
import { evaluateMemoryTrend } from './memoryTrend';
const history = (heaps: number[]) => heaps.map((heapUsedMb, index) => ({ ts: index * 300000, heapUsedMb, rssMb: heapUsedMb + 400 }));
it('does not call the supplied startup/warmup samples a sustained leak trend', () => {
    expect(evaluateMemoryTrend(history([130.7, 260.1, 221.5]), 12, 8)).toBeNull();
    expect(evaluateMemoryTrend(history([130.7, 260.1, 221.5]), 3, 8)).toBeNull();
});
it('requires a complete window and increasing low-water marks despite GC peaks', () => {
    expect(evaluateMemoryTrend(history(Array.from({ length: 11 }, (_, i) => 100 + i * 50)), 12, 8)).toBeNull();
    expect(evaluateMemoryTrend(history([100, 160, 220, 150, 200, 260, 210, 280, 320, 270, 340, 390]), 12, 8)).toBeNull();
    expect(evaluateMemoryTrend(history(Array.from({ length: 12 }, (_, i) => 100 + i * 50)), 12, 8)).toMatchObject({ heapSlopeMbPerMin: 10, windowPoints: 12 });
});
it('does not warn on a stable warmed heap or RSS-only/native-buffer growth', () => {
    expect(evaluateMemoryTrend(history([100, 350, 300, 280, 300, 350, 290, 310, 300, 280, 300, 310]), 12, 8)).toBeNull();
    expect(evaluateMemoryTrend(history(Array(12).fill(100)).map((point, i) => ({ ...point, rssMb: 200 + i * 100 })), 12, 8)).toBeNull();
});
