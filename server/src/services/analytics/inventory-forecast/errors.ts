/** Unsupported planning must never look like an empty, successful forecast. */
export class UnsupportedBOMForecastError extends Error {
    readonly statusCode = 409;
    readonly code = 'BOM_MULTI_LEVEL_PLANNING_REQUIRED';

    constructor() {
        super('BOM forecast unavailable: nested/cyclic component demand requires multi-level planning');
        this.name = 'UnsupportedBOMForecastError';
    }
}
