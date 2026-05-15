const BROADCAST_CONTACT_STATUS_FIELD = 'Contact Status';

const DEFAULT_BROADCAST_OPERATORS = ['is', 'is not', 'contains', 'greater than', 'less than'] as const;
const CONTACT_STATUS_OPERATORS = ['is', 'is not'] as const;

const NUMERIC_SEGMENT_FIELDS = new Set(['totalSpent', 'ordersCount']);

export function isBroadcastContactStatusField(field: string): boolean {
    return field === BROADCAST_CONTACT_STATUS_FIELD;
}

export function getBroadcastOperators(field: string): readonly string[] {
    return isBroadcastContactStatusField(field) ? CONTACT_STATUS_OPERATORS : DEFAULT_BROADCAST_OPERATORS;
}

export function getDefaultBroadcastOperator(field: string): string {
    return getBroadcastOperators(field)[0] || 'is';
}

export function getSegmentFieldType(field: string): 'number' | 'text' {
    return NUMERIC_SEGMENT_FIELDS.has(field) ? 'number' : 'text';
}
