interface EvaluateConditionInput {
    group?: string;
    field?: string;
    operator?: string;
    value?: unknown;
    conditions?: Array<{ field: string; operator: string; value: unknown }>;
    matchType?: 'all' | 'any';
}

export class AutomationConditionService {
    evaluate(config: EvaluateConditionInput, context: any): boolean {
        if (!config || !context) return true;

        const conditions = Array.isArray(config.conditions) && config.conditions.length > 0
            ? config.conditions
            : (config.field ? [{ field: config.field, operator: config.operator || 'eq', value: config.value }] : []);

        if (conditions.length === 0) return true;

        const evaluator = config.matchType === 'any' ? 'some' : 'every';
        return conditions[evaluator]((condition) => this.evaluateSingle(condition, context));
    }

    private evaluateSingle(condition: { field: string; operator: string; value: unknown }, context: any): boolean {
        const fieldVal = this.resolveFieldValue(condition.field, context);
        const operator = condition.operator || 'eq';
        const targetVal = condition.value;

        if (operator === 'is_set') return fieldVal !== undefined && fieldVal !== null && fieldVal !== '';
        if (operator === 'not_set') return fieldVal === undefined || fieldVal === null || fieldVal === '';

        const fieldArray = Array.isArray(fieldVal) ? fieldVal : null;
        if (fieldArray) {
            const normalizedArray = fieldArray.map((item) => String(item).toLowerCase());
            const needle = String(targetVal ?? '').toLowerCase();
            if (operator === 'contains' || operator === 'eq') return normalizedArray.includes(needle);
            if (operator === 'not_contains' || operator === 'neq') return !normalizedArray.includes(needle);
        }

        if (operator === 'between') {
            const range = this.parseRange(targetVal);
            const numericValue = this.toNumber(fieldVal);
            if (range && numericValue !== null) {
                return numericValue >= range.min && numericValue <= range.max;
            }

            const dateValue = this.toDate(fieldVal);
            if (range && dateValue) {
                return dateValue.getTime() >= range.min && dateValue.getTime() <= range.max;
            }
        }

        const numField = this.toNumber(fieldVal);
        const numTarget = this.toNumber(targetVal);
        if (numField !== null && numTarget !== null) {
            switch (operator) {
                case 'gt': return numField > numTarget;
                case 'gte': return numField >= numTarget;
                case 'lt': return numField < numTarget;
                case 'lte': return numField <= numTarget;
                case 'eq': return numField === numTarget;
                case 'neq': return numField !== numTarget;
                default: break;
            }
        }

        const dateField = this.toDate(fieldVal);
        const dateTarget = this.toDate(targetVal);
        if (dateField && dateTarget) {
            switch (operator) {
                case 'gt': return dateField.getTime() > dateTarget.getTime();
                case 'gte': return dateField.getTime() >= dateTarget.getTime();
                case 'lt': return dateField.getTime() < dateTarget.getTime();
                case 'lte': return dateField.getTime() <= dateTarget.getTime();
                case 'eq': return dateField.getTime() === dateTarget.getTime();
                case 'neq': return dateField.getTime() !== dateTarget.getTime();
                default: break;
            }
        }

        const left = String(fieldVal ?? '').toLowerCase();
        const right = String(targetVal ?? '').toLowerCase();
        switch (operator) {
            case 'eq': return left === right;
            case 'neq': return left !== right;
            case 'contains': return left.includes(right);
            case 'not_contains': return !left.includes(right);
            case 'starts_with': return left.startsWith(right);
            case 'gt': return left > right;
            case 'gte': return left >= right;
            case 'lt': return left < right;
            case 'lte': return left <= right;
            default: return true;
        }
    }

    private resolveFieldValue(fieldPath: string, context: any): unknown {
        if (!fieldPath) return undefined;

        switch (fieldPath) {
            case 'order.itemCount': {
                const items = context.order?.line_items || context.order?.lineItems || context.line_items || context.cart?.items || [];
                return Array.isArray(items)
                    ? items.reduce((sum: number, item: any) => sum + Number(item.quantity || 1), 0)
                    : 0;
            }
            case 'order.productId': {
                const items = context.order?.line_items || context.order?.lineItems || context.line_items || context.cart?.items || [];
                return Array.isArray(items)
                    ? items.map((item: any) => String(item.product_id ?? item.id ?? ''))
                    : [];
            }
            case 'order.categoryId': {
                const items = context.order?.line_items || context.order?.lineItems || context.line_items || [];
                return Array.isArray(items)
                    ? items.flatMap((item: any) => Array.isArray(item.categoryIds) ? item.categoryIds.map(String) : [])
                    : [];
            }
            case 'customer.tags':
                return context.customer?.tags || context.tags || [];
            case 'customer.emailDomain':
                return context.customer?.emailDomain || context.email?.split?.('@')?.[1] || '';
            case 'customer.lastOrderDate':
                return context.customer?.lastOrderDate || context.lastPurchaseAt || null;
            case 'customer.daysSinceLastOrder':
                return context.customer?.daysSinceLastOrder ?? context.daysSinceLastPurchase ?? null;
            case 'customer.country':
                return context.customer?.country || context.billing?.country || context.order?.billing?.country || context.country;
            case 'customer.state':
                return context.customer?.state || context.billing?.state || context.order?.billing?.state || context.state;
            case 'customer.city':
                return context.customer?.city || context.billing?.city || context.order?.billing?.city || context.city;
            case 'customer.postcode':
                return context.customer?.postcode || context.billing?.postcode || context.order?.billing?.postcode || context.postcode;
            case 'order.status':
                return context.order?.status || context.status || context.newStatus;
            case 'order.couponCode': {
                const couponLines = context.order?.coupon_lines || context.coupon_lines || [];
                return Array.isArray(couponLines)
                    ? couponLines.map((coupon: any) => String(coupon.code || ''))
                    : [];
            }
            case 'segment.id':
                return context.segmentIds || context.customer?.segmentIds || [];
            case 'email.opened':
                return Boolean(context.email?.opened);
            case 'email.clicked':
                return Boolean(context.email?.clicked);
            case 'date.dayOfWeek':
                return new Date().getDay();
            case 'date.hour':
                return new Date().getHours();
            case 'date.month':
                return new Date().getMonth() + 1;
            default:
                return fieldPath.split('.').reduce((acc: any, key: string) => {
                    if (acc === undefined || acc === null) return undefined;
                    return acc[key];
                }, context);
        }
    }

    private toNumber(value: unknown): number | null {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    private toDate(value: unknown): Date | null {
        if (!value || typeof value === 'boolean') return null;
        const parsed = new Date(String(value));
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    private parseRange(value: unknown): { min: number; max: number } | null {
        if (typeof value !== 'string') return null;

        const parts = value
            .split(/,|-/)
            .map((part) => Number(part.trim()))
            .filter((part) => Number.isFinite(part));

        if (parts.length !== 2) return null;

        return {
            min: Math.min(parts[0], parts[1]),
            max: Math.max(parts[0], parts[1])
        };
    }
}

export const automationConditionService = new AutomationConditionService();
