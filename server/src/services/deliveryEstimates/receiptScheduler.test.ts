import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ stock: vi.fn(), cascade: vi.fn(), writeOff: vi.fn(), controls: vi.fn(), legacy: vi.fn(), reconcile: vi.fn() }));
vi.mock('./receiptWorker', () => ({ drainGuardedReceipts: m.stock }));
vi.mock('./receiptCascade', () => ({ drainReceiptCascades: m.cascade }));
vi.mock('../stockWriteOffCascade', () => ({ drainWriteOffCascades: m.writeOff }));
vi.mock('./launch', () => ({ drainDeliveryControls: m.controls }));
vi.mock('./legacyRecovery', () => ({ drainLegacyResolutions: m.legacy }));
vi.mock('./reconciliation', () => ({ drainReconciliations: m.reconcile }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: vi.fn() } }));
import { GuardedReceiptScheduler } from '../scheduler/GuardedReceiptScheduler';
beforeEach(() => vi.resetAllMocks());
it('continues internal write-off retries even when the receipt cascade drain fails', async () => {
    m.cascade.mockRejectedValueOnce(new Error('receipt drain failed'));
    await GuardedReceiptScheduler.cascadeTick();
    expect(m.writeOff).toHaveBeenCalledTimes(1);
    await GuardedReceiptScheduler.cascadeTick();
    expect(m.writeOff).toHaveBeenCalledTimes(2);
});
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
