export const INVOICE_SOURCE_CHANGED = 'Invoice source changed; request a current artifact';
export const INVOICE_SOURCE_CHANGED_BEFORE_RENDER = 'Invoice source changed before rendering';
export const INVOICE_SEQUENCE_CHANGED = 'Invoice sequence changed; generation requires reconciliation';

/** Throw only when this attempt is known not to have reserved an invoice number. */
export class InvoicePreReservationConflict extends Error {}

// Exact errors emitted before reservation by older API images. Do not infer
// safety from a substring match, an unknown exception, or a timeout.
export function isLegacyPreReservationConflict(message: string | null) {
    return message === INVOICE_SOURCE_CHANGED || message === INVOICE_SOURCE_CHANGED_BEFORE_RENDER || message === INVOICE_SEQUENCE_CHANGED;
}
