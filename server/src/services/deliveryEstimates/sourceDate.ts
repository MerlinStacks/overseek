/** PO expectedDate is a calendar label. Preserve the source's leading date even
 * when older clients submit a timestamp with an offset; do not shift its day.
 */
export function purchaseOrderDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const label = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value)?.[1];
    const date = label ? new Date(`${label}T00:00:00.000Z`) : null;
    if (!date || !Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.toISOString().slice(0, 10) !== label
        || (value.length > 10 && !Number.isFinite(Date.parse(value)))) throw new Error('Invalid Purchase Order expected date');
    return date;
}
