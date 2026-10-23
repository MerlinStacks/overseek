/** Cyclic planning must never look like an empty, successful forecast. */
export class BOMForecastCycleError extends Error {
    readonly statusCode = 409;
    readonly code = 'BOM_CYCLE_DETECTED';

    constructor() {
        super('BOM forecast unavailable: cyclic component references detected');
        this.name = 'BOMForecastCycleError';
    }
}
