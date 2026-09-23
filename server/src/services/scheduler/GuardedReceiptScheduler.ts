import { drainGuardedReceipts } from '../deliveryEstimates/receiptWorker';
import { drainDeliveryControls } from '../deliveryEstimates/launch';
import { drainReconciliations } from '../deliveryEstimates/reconciliation';
import { drainLegacyResolutions } from '../deliveryEstimates/legacyRecovery';
import { drainReceiptCascades } from '../deliveryEstimates/receiptCascade';
import { Logger } from '../../utils/logger';

export class GuardedReceiptScheduler {
    private static timer: ReturnType<typeof setInterval> | undefined;
    private static cascadeTimer: ReturnType<typeof setInterval> | undefined;
    private static running = false;
    private static cascadeRunning = false;
    static start() {
        if (this.timer) return;
        this.timer = setInterval(() => { void this.tick(); }, 2_000);
        this.timer.unref();
        this.cascadeTimer = setInterval(() => { void this.cascadeTick(); }, 5_000);
        this.cascadeTimer.unref();
    }
    static async tick() {
        if (this.running) return;
        this.running = true;
        try { await drainDeliveryControls(); await drainLegacyResolutions(); await drainGuardedReceipts(); await drainReconciliations(); }
        catch { Logger.warn('Guarded receipt drain failed'); }
        finally { this.running = false; }
    }
    static async cascadeTick() {
        if (this.cascadeRunning) return;
        this.cascadeRunning = true;
        try { await drainReceiptCascades(); }
        catch { Logger.warn('Receipt BOM cascade drain failed'); }
        finally { this.cascadeRunning = false; }
    }
    static stop() { clearInterval(this.timer); clearInterval(this.cascadeTimer); this.timer = undefined; this.cascadeTimer = undefined; }
}
