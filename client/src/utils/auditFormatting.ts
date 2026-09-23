const normalize = (key: string) => key.replace(/[_\s-]/g, '').toLowerCase();

const labels: Record<string, string> = {
    name: 'Name', stockstatus: 'Stock availability', stockquantity: 'Stock quantity',
    managestock: 'Stock tracking', regularprice: 'Regular price', saleprice: 'Sale price',
    shortdescription: 'Short description', sku: 'SKU', cogs: 'Cost of goods',
    supplierid: 'Supplier', binlocation: 'Bin location', focuskeyword: 'SEO focus keyword',
    isgoldpriceapplied: 'Gold pricing', metadata: 'Additional information',
    childwooid: 'Component product ID', requiredqty: 'Quantity required', childstock: 'Component stock',
    buildableunits: 'Units that can be built', variationid: 'Variation ID', variationwooid: 'Variation ID',
    trigger: 'Reason', movementtype: 'Stock movement', src: 'Image URL', id: 'ID',
};

export function auditFieldLabel(key: string): string {
    const label = labels[normalize(key)];
    if (label) return label;
    const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

const enums: Record<string, Record<string, string>> = {
    stockstatus: { instock: 'In stock', outofstock: 'Out of stock', onbackorder: 'On backorder' },
    status: { publish: 'Published', draft: 'Draft', pending: 'Pending review', private: 'Private', trash: 'In trash' },
    backorders: { no: 'Not allowed', notify: 'Allowed with customer notification', yes: 'Allowed' },
    catalogvisibility: { visible: 'Shop and search results', catalog: 'Shop only', search: 'Search results only', hidden: 'Hidden' },
    trigger: { BOM_INVENTORY_SYNC: 'Stock recalculated from component availability', ORDER_BOM_DEDUCTION: 'Components used for an order' },
    movementtype: { PO_RECEIPT: 'Purchase order received', PO_REVERSAL: 'Purchase order receipt reversed' },
    taxstatus: { taxable: 'Taxable', shipping: 'Shipping only', none: 'Not taxable' },
    producttype: { INTERNAL: 'Internal product', simple: 'Simple product', variable: 'Variable product' },
};

/** Never render stored markup as HTML or expose nested data as JSON. */
export function auditValueText(key: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return 'Not set';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) {
        if (!value.length) return 'None';
        return value.map(item => auditValueText(key, item)).join('; ');
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (['categories', 'tags'].includes(key)) {
            if (typeof record.name === 'string') return record.name;
            if (typeof record.id === 'number' || typeof record.id === 'string') {
                return `${key === 'categories' ? 'Category' : 'Tag'} #${record.id}`;
            }
        }
        const entries = Object.entries(record);
        return entries.length
            ? entries.map(([field, entry]) => `${auditFieldLabel(field)}: ${auditValueText(field, entry)}`).join(', ')
            : 'None';
    }
    if (value === '[updated]') return 'Updated';
    return enums[normalize(key)]?.[String(value)] ?? String(value);
}

export function auditChangeText(key: string, value: unknown, previous?: Record<string, unknown>): string {
    const label = auditFieldLabel(key);
    // These fields contain HTML, editor content or machine-oriented metadata, not useful prose.
    if (['description', 'shortdescription', 'metadata'].includes(normalize(key))) {
        return `${label} ${value === '' || value === null || (Array.isArray(value) && !value.length) ? 'cleared' : 'updated'}.`;
    }
    if (value === '[updated]') return `${label} updated.`;
    const previousKey = Object.keys(previous ?? {}).find(field => normalize(field) === normalize(key));
    if (previousKey !== undefined) {
        return `${label} changed from ${auditValueText(key, previous![previousKey])} to ${auditValueText(key, value)}.`;
    }
    return `${label}: ${auditValueText(key, value)}.`;
}

export function auditActionText(action: string, resource: string): string {
    const verbs: Record<string, string> = {
        CREATE: 'Created', UPDATE: 'Updated', DELETE: 'Deleted', SYNC: 'Synced',
        BATCH_UPDATE: 'Updated', RESTORE: 'Restored', STOCK_UPDATE: 'Updated stock for',
    };
    return `${verbs[action.toUpperCase()] ?? 'Recorded activity for'} this ${resource.toLowerCase().replace(/_/g, ' ')}`;
}
