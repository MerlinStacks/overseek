/** Empty and malformed values are unknown, never zero. */
export function bomNumber(value: unknown): number {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()))) return NaN;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : NaN;
}
export function validStock(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function validBOMValues(item: { quantity: number; wasteFactor: number }): boolean {
    return Number.isFinite(item.quantity) && item.quantity > 0 && Number.isFinite(item.wasteFactor) && item.wasteFactor >= 0;
}
