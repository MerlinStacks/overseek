import { expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ stock: vi.fn(), cascade: vi.fn(), controls: vi.fn(), legacy: vi.fn(), reconcile: vi.fn() }));
vi.mock('./receiptWorker', () => ({ drainGuardedReceipts: m.stock }));
vi.mock('./receiptCascade', () => ({ drainReceiptCascades: m.cascade }));
vi.mock('./launch', () => ({ drainDeliveryControls: m.controls }));
vi.mock('./legacyRecovery', () => ({ drainLegacyResolutions: m.legacy }));
vi.mock('./reconciliation', () => ({ drainReconciliations: m.reconcile }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: vi.fn() } }));
import { GuardedReceiptScheduler } from '../scheduler/GuardedReceiptScheduler';
it('continues stock/control processing while a long derived cascade is running', async () => {
    let finish!: () => void;
    m.cascade.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const running = GuardedReceiptScheduler.cascadeTick();
    await GuardedReceiptScheduler.tick(); await GuardedReceiptScheduler.tick();
    await GuardedReceiptScheduler.cascadeTick();
    expect(m.stock).toHaveBeenCalledTimes(2); expect(m.controls).toHaveBeenCalledTimes(2);
    expect(m.cascade).toHaveBeenCalledTimes(1);
    finish(); await running; GuardedReceiptScheduler.stop();
});
