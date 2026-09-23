import { drainDeliveryInputs } from '../deliveryEstimates/sync';
import { Logger } from '../../utils/logger';

export class DeliveryInputScheduler {
    private static timer: ReturnType<typeof setInterval> | undefined;
    private static running = false;
    static start() {
        if (this.timer) return;
        this.timer = setInterval(() => { void this.tick(); }, 15_000);
        this.timer.unref();
    }
    static async tick() {
        if (this.running) return;
        this.running = true;
        try { await drainDeliveryInputs(); }
        catch { Logger.warn('Delivery input drain failed'); }
        finally { this.running = false; }
    }
    static stop() {
        clearInterval(this.timer);
        this.timer = undefined;
    }
}
