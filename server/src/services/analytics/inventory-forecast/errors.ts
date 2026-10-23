/** Invalid active recipes are a correctable planning conflict, not a server crash. */
export class BOMForecastDataError extends Error {
    readonly statusCode = 409;
    readonly code: string;

    constructor(message: string, code = 'BOM_FORECAST_INVALID') {
        super(message);
        this.name = 'BOMForecastDataError';
        this.code = code;
    }
}

/** Cyclic planning must never look like an empty, successful forecast. */
export class BOMForecastCycleError extends BOMForecastDataError {
    constructor() {
        super('BOM forecast unavailable: cyclic component references detected', 'BOM_CYCLE_DETECTED');
        this.name = 'BOMForecastCycleError';
    }
}
