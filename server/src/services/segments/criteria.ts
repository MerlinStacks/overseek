export interface SegmentRule {
    field: string;
    operator: string;
    value: unknown;
    campaignId?: string;
    withinDays?: string;
    valueLabel?: string;
}

export interface SegmentCriteria {
    type: 'AND' | 'OR';
    rules: SegmentRule[];
}

export const engagementFields = ['emailOpenedWithinDays', 'emailClickedWithinDays', 'notEmailOpenedWithinDays', 'notEmailClickedWithinDays'];
export const rollingFields = ['purchasedWithinDays', 'notPurchasedWithinDays', 'abandonedCartWithinDays', ...engagementFields];
export const purchaseFields = ['purchasedProduct', 'purchasedCategory'];

export function validateCriteria(criteria: unknown): string | null {
    const input = criteria as SegmentCriteria;
    if (!input || !['AND', 'OR'].includes(input.type) || !Array.isArray(input.rules) || input.rules.length > 30) {
        return 'Invalid segment criteria';
    }
    for (const rule of input.rules) {
        if (!rule || typeof rule !== 'object') return 'Invalid segment rule';
        if (rule.valueLabel !== undefined && (typeof rule.valueLabel !== 'string' || rule.valueLabel.length > 500)) return 'Invalid selection label';
        if (rule.withinDays !== undefined && (!purchaseFields.includes(rule.field) || !/^\d+$/.test(String(rule.withinDays)) || Number(rule.withinDays) < 1 || Number(rule.withinDays) > 3650)) return 'Purchase windows must be whole days between 1 and 3650';
        if (rule.campaignId !== undefined && (!engagementFields.includes(rule.field) || typeof rule.campaignId !== 'string' || !rule.campaignId.trim() || rule.campaignId.length > 200)) return 'Invalid email campaign ID';
        if (purchaseFields.includes(rule.field)) {
            if (!['purchased', 'notPurchased'].includes(rule.operator) || !/^\d+$/.test(String(rule.value)) || !Number.isSafeInteger(Number(rule.value)) || Number(rule.value) < 1) return 'Select a valid product or category';
        } else if (rollingFields.includes(rule.field)) {
            const days = Number(rule.value);
            if (rule.operator !== 'within' || !Number.isInteger(days) || days < 1 || days > 3650) {
                return 'Rolling windows must be whole days between 1 and 3650';
            }
        } else if (['totalSpent', 'ordersCount'].includes(rule.field)) {
            if (!['gt', 'lt', 'gte', 'lte', 'eq'].includes(rule.operator) || rule.value === '' || !Number.isFinite(Number(rule.value)) || Number(rule.value) < 0) return 'Invalid numeric segment rule';
        } else if (['email', 'firstName', 'lastName'].includes(rule.field)) {
            if (!['contains', 'equals', 'startsWith'].includes(rule.operator) || typeof rule.value !== 'string' || !rule.value.trim()) return 'Invalid text segment rule';
        } else return 'Unsupported segment field';
    }
    return null;
}
