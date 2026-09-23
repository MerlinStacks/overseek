/**
 * Native wc/v3 COGS request shape, verified against WooCommerce's
 * src/Internal/CostOfGoodsSold/CogsAwareRestControllerTrait.php.
 * Missing/blank costs are unknown, not zero. Only explicit numbers are exported.
 * Variation costs replace the parent cost rather than adding to it.
 */
export function nativeWooCogs(cogs: unknown, variation = false) {
    if (cogs === undefined || cogs === null || (typeof cogs === 'string' && cogs.trim() === '')) return {};
    const value = Number(cogs);
    if ((typeof cogs !== 'number' && typeof cogs !== 'string') || !Number.isFinite(value) || value < 0) {
        throw new Error('COGS must be a finite non-negative number');
    }
    return {
        cost_of_goods_sold: {
            values: [{ defined_value: value }],
            ...(variation ? { defined_value_is_additive: false } : {}),
        },
    };
}
