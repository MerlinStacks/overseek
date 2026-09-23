/** Legacy NULL statuses remain usable; only explicit trash is excluded. */
export const activeProductWhere = { OR: [{ status: null }, { status: { not: 'trash' } }] };
