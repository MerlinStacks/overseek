export const generateId = (): string => {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
    } catch (e) {
        // Ignore
    }
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

export const TOOLBOX_ITEMS = [
    { id: 'text', type: 'text', label: 'Text Block' }, // Icon handled in component import to avoid circular dep or heavy imports if not needed
    { id: 'image', type: 'image', label: 'Image' },
    { id: 'order_table', type: 'order_table', label: 'Order Items' },
    { id: 'totals', type: 'totals', label: 'Totals & Tax' },
];
