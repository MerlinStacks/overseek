/**
 * ConditionConfig - Configuration panel for flow condition nodes.
 * Extracted from NodeConfigPanel for modularity.
 */
/* eslint-disable react-refresh/only-export-components */
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';

type MatchType = 'all' | 'any';

interface ConditionRule {
    field: string;
    operator: string;
    value: string;
}

interface ConditionNodeConfig {
    group?: string;
    matchType?: MatchType;
    conditions?: ConditionRule[];
}

export interface ConditionConfigProps {
    config: ConditionNodeConfig;
    onUpdate: (key: string, value: unknown) => void;
}

interface ConditionOption {
    field: string;
    label: string;
    operators: string[];
}

interface ConditionGroup {
    id: string;
    label: string;
    icon: string;
    conditions: ConditionOption[];
}

interface ProductOption {
    id: string;
    name: string;
}

interface CategoryOption {
    id: string;
    name: string;
}

interface SegmentOption {
    id: string;
    name: string;
}

interface EmailListOption {
    id: string;
    name: string;
}

interface WooOrderStatusesResponse {
    data?: Array<{ slug?: string }> | Record<string, { slug?: string }>;
}

const DEFAULT_ORDER_STATUSES = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'];

const formatStatusLabel = (status: string) => status
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const normalizeStatusSlug = (status: string) => status.replace(/^wc-/, '').toLowerCase();

const DAY_OF_WEEK_OPTIONS = [
    { value: 'monday', label: 'Monday' },
    { value: 'tuesday', label: 'Tuesday' },
    { value: 'wednesday', label: 'Wednesday' },
    { value: 'thursday', label: 'Thursday' },
    { value: 'friday', label: 'Friday' },
    { value: 'saturday', label: 'Saturday' },
    { value: 'sunday', label: 'Sunday' },
];

const MONTH_OPTIONS = [
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
];

const COUNTRY_OPTIONS = [
    'United States',
    'United Kingdom',
    'Canada',
    'Australia',
    'New Zealand',
    'Ireland',
    'Germany',
    'France',
    'Italy',
    'Spain',
    'Netherlands',
    'Sweden',
    'Norway',
    'Denmark',
    'Switzerland',
    'Belgium',
    'Austria',
    'Portugal',
    'Poland',
    'Czech Republic',
    'Japan',
    'South Korea',
    'Singapore',
    'India',
    'Brazil',
    'Mexico',
    'South Africa',
];

const NUMERIC_FIELDS = new Set([
    'order.total',
    'order.itemCount',
    'customer.totalSpent',
    'customer.ordersCount',
    'customer.daysSinceLastOrder',
    'user.registeredDays',
]);

const escapePreviewValue = (value: string) => value.replace(/"/g, '\\"');

/** Condition group definitions matching FunnelKit pattern */
export const CONDITION_GROUPS: ConditionGroup[] = [
    {
        id: 'segments',
        label: 'Segments',
        icon: 'List',
        conditions: [
            { field: 'segment.id', label: 'Contact is in Segment', operators: ['eq', 'neq'] },
            { field: 'list.id', label: 'Contact is in List', operators: ['eq', 'neq'] },
        ]
    },
    {
        id: 'contact',
        label: 'Contact Details',
        icon: 'Contact',
        conditions: [
            { field: 'customer.email', label: 'Email address', operators: ['contains', 'not_contains', 'eq', 'neq'] },
            { field: 'customer.emailDomain', label: 'Email domain', operators: ['eq', 'neq', 'contains', 'not_contains'] },
            { field: 'customer.phone', label: 'Phone number', operators: ['is_set', 'not_set', 'eq'] },
            { field: 'customer.firstName', label: 'First name', operators: ['eq', 'neq', 'contains'] },
            { field: 'customer.lastName', label: 'Last name', operators: ['eq', 'neq', 'contains'] },
            { field: 'customer.tags', label: 'Has tag', operators: ['contains', 'not_contains'] },
        ]
    },
    {
        id: 'woocommerce',
        label: 'WooCommerce',
        icon: 'Store',
        conditions: [
            { field: 'order.total', label: 'Order Total', operators: ['gt', 'gte', 'lt', 'lte', 'eq'] },
            { field: 'order.status', label: 'Order Status', operators: ['eq', 'neq'] },
            { field: 'order.itemCount', label: 'Order Item Count', operators: ['gt', 'gte', 'lt', 'lte', 'eq'] },
            { field: 'order.productId', label: 'Order contains product', operators: ['eq', 'neq'] },
            { field: 'order.categoryId', label: 'Order contains category', operators: ['eq', 'neq'] },
            { field: 'order.couponCode', label: 'Order used coupon', operators: ['contains', 'not_contains', 'eq', 'neq'] },
            { field: 'customer.totalSpent', label: 'Customer Lifetime Value', operators: ['gt', 'gte', 'lt', 'lte'] },
            { field: 'customer.ordersCount', label: 'Customer Total Orders', operators: ['gt', 'gte', 'lt', 'lte', 'eq'] },
            { field: 'customer.daysSinceLastOrder', label: 'Days Since Last Order', operators: ['gt', 'gte', 'lt', 'lte', 'eq'] },
            { field: 'customer.lastOrderDate', label: 'Last Order Date', operators: ['gt', 'gte', 'lt', 'lte', 'eq'] },
        ]
    },
    {
        id: 'user',
        label: 'User',
        icon: 'User',
        conditions: [
            { field: 'user.role', label: 'User Role', operators: ['eq', 'neq'] },
            { field: 'user.isLoggedIn', label: 'Is Logged In', operators: ['eq'] },
            { field: 'user.registeredDays', label: 'Days since registration', operators: ['gt', 'lt', 'eq'] },
        ]
    },
    {
        id: 'geography',
        label: 'Geography',
        icon: 'Geo',
        conditions: [
            { field: 'customer.country', label: 'Country', operators: ['eq', 'neq'] },
            { field: 'customer.state', label: 'State/Province', operators: ['eq', 'neq'] },
            { field: 'customer.city', label: 'City', operators: ['eq', 'neq', 'contains'] },
            { field: 'customer.postcode', label: 'Postcode', operators: ['eq', 'neq', 'starts_with'] },
        ]
    },
    {
        id: 'engagement',
        label: 'Engagement',
        icon: 'Engage',
        conditions: [
            { field: 'email.opened', label: 'Opened any email', operators: ['eq'] },
            { field: 'email.openedRecent', label: 'Opened email in last X days', operators: ['eq'] },
            { field: 'email.clicked', label: 'Clicked any link', operators: ['eq'] },
            { field: 'email.clickedRecent', label: 'Clicked link in last X days', operators: ['eq'] },
            { field: 'inbox.customerSentEmail', label: 'Sent any email to inbox', operators: ['eq'] },
        ]
    },
    {
        id: 'datetime',
        label: 'DateTime',
        icon: 'Date',
        conditions: [
            { field: 'date.dayOfWeek', label: 'Day of Week', operators: ['eq', 'neq'] },
            { field: 'date.hour', label: 'Hour of Day', operators: ['eq', 'gt', 'lt', 'between'] },
            { field: 'date.month', label: 'Month', operators: ['eq', 'neq'] },
        ]
    },
];

export const OPERATOR_LABELS: Record<string, string> = {
    'eq': 'equals',
    'neq': 'not equals',
    'gt': 'greater than',
    'gte': 'greater than or equal',
    'lt': 'less than',
    'lte': 'less than or equal',
    'contains': 'contains',
    'not_contains': 'does not contain',
    'is_set': 'is set',
    'not_set': 'is not set',
    'starts_with': 'starts with',
    'between': 'is between',
};

const OPERATORS_WITHOUT_VALUE = new Set(['is_set', 'not_set']);

const conditionHasRequiredValue = (condition: ConditionRule) => {
    if (OPERATORS_WITHOUT_VALUE.has(condition.operator)) return true;
    return String(condition.value ?? '').trim() !== '';
};

export const ConditionConfig: React.FC<ConditionConfigProps> = ({ config, onUpdate }) => {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [activeGroup, setActiveGroup] = useState(config.group || 'woocommerce');
    const [conditions, setConditions] = useState<ConditionRule[]>(config.conditions || [{ field: '', operator: '', value: '' }]);
    const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
    const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
    const [segmentOptions, setSegmentOptions] = useState<SegmentOption[]>([]);
    const [emailListOptions, setEmailListOptions] = useState<EmailListOption[]>([]);
    const [orderStatusOptions, setOrderStatusOptions] = useState<string[]>(DEFAULT_ORDER_STATUSES);
    const [isLoadingFilterOptions, setIsLoadingFilterOptions] = useState(false);

    useEffect(() => {
        setActiveGroup(config.group || 'woocommerce');
        setConditions(config.conditions || [{ field: '', operator: '', value: '' }]);
    }, [config.group, config.conditions]);

    const activeGroupData = CONDITION_GROUPS.find(g => g.id === activeGroup);
    const availableConditions = activeGroupData?.conditions || [];

    const getOperatorsForField = (fieldValue: string) => {
        for (const group of CONDITION_GROUPS) {
            const condition = group.conditions.find(c => c.field === fieldValue);
            if (condition) {
                return condition.operators;
            }
        }
        return ['eq', 'neq', 'gt', 'lt'];
    };

    const updateCondition = (index: number, key: keyof ConditionRule, value: string) => {
        const updated = [...conditions];
        updated[index] = { ...updated[index], [key]: value };
        setConditions(updated);
        onUpdate('conditions', updated);
    };

    const addCondition = () => {
        const updated = [...conditions, { field: '', operator: '', value: '' }];
        setConditions(updated);
        onUpdate('conditions', updated);
    };

    const removeCondition = (index: number) => {
        if (conditions.length <= 1) return;
        const updated = conditions.filter((_, i) => i !== index);
        setConditions(updated);
        onUpdate('conditions', updated);
    };

    useEffect(() => {
        onUpdate('group', activeGroup);
    }, [activeGroup, onUpdate]);

    useEffect(() => {
        const loadFilterOptions = async () => {
            if (!token || !currentAccount?.id) return;

            setIsLoadingFilterOptions(true);
            try {
                const [productsRes, categoriesRes, wooStatusesRes, segmentsRes, listsRes] = await Promise.all([
                    fetch('/api/products?limit=100', {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'X-Account-ID': currentAccount.id,
                        }
                    }),
                    fetch('/api/products/categories?limit=100', {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'X-Account-ID': currentAccount.id,
                        }
                    }),
                    fetch('/api/woocommerce/order-statuses', {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'X-Account-ID': currentAccount.id,
                        }
                    }),
                    fetch('/api/segments', {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'X-Account-ID': currentAccount.id,
                        }
                    }),
                    fetch('/api/email/lists', {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'X-Account-ID': currentAccount.id,
                        }
                    }),
                ]);

                if (productsRes.ok) {
                    const productsData = await productsRes.json();
                    const rawProducts = Array.isArray(productsData.products)
                        ? productsData.products
                        : Array.isArray(productsData.items)
                            ? productsData.items
                            : [];

                    const mappedProducts = rawProducts
                        .map((product: { id?: string; wooId?: number | string; name?: string }) => ({
                            id: String(product.wooId ?? product.id ?? ''),
                            name: product.name || 'Unnamed Product'
                        }))
                        .filter((product: ProductOption) => product.id)
                        .sort((a: ProductOption, b: ProductOption) => a.name.localeCompare(b.name));

                    setProductOptions(mappedProducts);
                }

                if (categoriesRes.ok) {
                    const categoriesData = await categoriesRes.json();
                    const rawCategories = Array.isArray(categoriesData.items) ? categoriesData.items : [];

                    const mappedCategories = rawCategories
                        .map((category: { id?: number | string; name?: string }) => ({
                            id: String(category.id ?? ''),
                            name: category.name || 'Unnamed Category'
                        }))
                        .filter((category: CategoryOption) => category.id)
                        .sort((a: CategoryOption, b: CategoryOption) => a.name.localeCompare(b.name));

                    setCategoryOptions(mappedCategories);
                }

                if (wooStatusesRes.ok) {
                    const wooStatusesData = await wooStatusesRes.json() as WooOrderStatusesResponse;
                    const source = wooStatusesData.data;
                    const dynamicFromWoo = Array.isArray(source)
                        ? source
                            .map((item) => item.slug)
                            .filter((status): status is string => Boolean(status))
                            .map(normalizeStatusSlug)
                        : Object.keys(source || {}).filter(Boolean).map(normalizeStatusSlug);

                    const merged = Array.from(new Set([...DEFAULT_ORDER_STATUSES, ...dynamicFromWoo])).sort((a, b) => a.localeCompare(b));
                    setOrderStatusOptions(merged);
                }

                if (segmentsRes.ok) {
                    const segmentsData = await segmentsRes.json();
                    const rawSegments = Array.isArray(segmentsData) ? segmentsData : [];
                    const mappedSegments = rawSegments
                        .map((segment: { id?: string; name?: string }) => ({
                            id: String(segment.id ?? ''),
                            name: segment.name || 'Unnamed Segment',
                        }))
                        .filter((segment: SegmentOption) => segment.id)
                        .sort((a: SegmentOption, b: SegmentOption) => a.name.localeCompare(b.name));

                    setSegmentOptions(mappedSegments);
                }

                if (listsRes.ok) {
                    const listsData = await listsRes.json();
                    const rawLists = Array.isArray(listsData) ? listsData : [];
                    const mappedLists = rawLists
                        .map((list: { id?: string; name?: string }) => ({
                            id: String(list.id ?? ''),
                            name: list.name || 'Unnamed List',
                        }))
                        .filter((list: EmailListOption) => list.id)
                        .sort((a: EmailListOption, b: EmailListOption) => a.name.localeCompare(b.name));

                    setEmailListOptions(mappedLists);
                }
            } finally {
                setIsLoadingFilterOptions(false);
            }
        };

        void loadFilterOptions();
    }, [token, currentAccount?.id]);

    const renderConditionValueInput = (cond: ConditionRule, idx: number) => {
        if (cond.field === 'order.productId') {
            return (
                <select
                    value={cond.value || ''}
                    onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                    disabled={isLoadingFilterOptions}
                >
                    <option value="">Select product...</option>
                    {productOptions.map((product) => (
                        <option key={product.id} value={product.id}>{product.name}</option>
                    ))}
                </select>
            );
        }

        if (cond.field === 'order.categoryId') {
            return (
                <select
                    value={cond.value || ''}
                    onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                    disabled={isLoadingFilterOptions}
                >
                    <option value="">Select category...</option>
                    {categoryOptions.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                </select>
            );
        }

        if (cond.field === 'order.status') {
            return (
                <select
                    value={cond.value || ''}
                    onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                >
                    <option value="">Select status...</option>
                    {orderStatusOptions.map((status) => (
                        <option key={status} value={status}>{formatStatusLabel(status)}</option>
                    ))}
                </select>
            );
        }

        if (cond.field === 'segment.id') {
            return (
                <select
                    value={cond.value || ''}
                    onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                    disabled={isLoadingFilterOptions}
                >
                    <option value="">Select segment...</option>
                    {segmentOptions.map((segment) => (
                        <option key={segment.id} value={segment.id}>{segment.name}</option>
                    ))}
                </select>
            );
        }

        if (cond.field === 'list.id') {
            return (
                <select
                    value={cond.value || ''}
                    onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                    disabled={isLoadingFilterOptions}
                >
                    <option value="">Select list...</option>
                    {emailListOptions.map((list) => (
                        <option key={list.id} value={list.id}>{list.name}</option>
                    ))}
                </select>
            );
        }

        if (cond.field === 'user.isLoggedIn' || cond.field === 'inbox.customerSentEmail') {
            return (
                <select
                    value={cond.value || ''}
                    onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                >
                    <option value="">Select value...</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                </select>
            );
        }

        if (cond.field === 'date.dayOfWeek') {
            return (
                <select
                    value={cond.value || ''}
                    onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                >
                    <option value="">Select day...</option>
                    {DAY_OF_WEEK_OPTIONS.map((day) => (
                        <option key={day.value} value={day.value}>{day.label}</option>
                    ))}
                </select>
            );
        }

        if (cond.field === 'date.month') {
            return (
                <select
                    value={cond.value || ''}
                    onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                >
                    <option value="">Select month...</option>
                    {MONTH_OPTIONS.map((month) => (
                        <option key={month.value} value={month.value}>{month.label}</option>
                    ))}
                </select>
            );
        }

        if (cond.field === 'date.hour') {
            return (
                <input
                    type="number"
                    min={0}
                    max={23}
                    value={cond.value || ''}
                    onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                    placeholder="0-23"
                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                />
            );
        }

        if (cond.field === 'customer.lastOrderDate') {
            return (
                <input
                    type="date"
                    value={cond.value || ''}
                    onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                />
            );
        }

        if (cond.field === 'customer.country') {
            return (
                <select
                    value={cond.value || ''}
                    onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                >
                    <option value="">Select country...</option>
                    {COUNTRY_OPTIONS.map((country) => (
                        <option key={country} value={country}>{country}</option>
                    ))}
                </select>
            );
        }

        if (NUMERIC_FIELDS.has(cond.field)) {
            return (
                <input
                    type="number"
                    value={cond.value || ''}
                    onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                    placeholder="Value..."
                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                />
            );
        }

        return (
            <input
                type="text"
                value={cond.value || ''}
                onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                placeholder="Value..."
                className="text-sm border border-gray-300 rounded-sm px-2 py-1"
            />
        );
    };

    const getConditionValueLabel = (cond: ConditionRule) => {
        if (!cond.value) return '';

        if (cond.field === 'order.productId') {
            return productOptions.find((product) => product.id === cond.value)?.name || cond.value;
        }

        if (cond.field === 'order.categoryId') {
            return categoryOptions.find((category) => category.id === cond.value)?.name || cond.value;
        }

        if (cond.field === 'segment.id') {
            return segmentOptions.find((segment) => segment.id === cond.value)?.name || cond.value;
        }

        if (cond.field === 'list.id') {
            return emailListOptions.find((list) => list.id === cond.value)?.name || cond.value;
        }

        if (cond.field === 'order.status') {
            return formatStatusLabel(cond.value);
        }

        if (cond.field === 'user.isLoggedIn' || cond.field === 'inbox.customerSentEmail') {
            if (cond.value === 'true') return 'Yes';
            if (cond.value === 'false') return 'No';
        }

        if (cond.field === 'date.dayOfWeek') {
            return DAY_OF_WEEK_OPTIONS.find((day) => day.value === cond.value)?.label || cond.value;
        }

        if (cond.field === 'date.month') {
            return MONTH_OPTIONS.find((month) => month.value === cond.value)?.label || cond.value;
        }

        return cond.value;
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Add Conditions</label>
                <span className="text-xs text-gray-500">Match {config.matchType || 'all'} conditions</span>
            </div>

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => onUpdate('matchType', 'all')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${(config.matchType || 'all') === 'all'
                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                >
                    Match ALL (AND)
                </button>
                <button
                    type="button"
                    onClick={() => onUpdate('matchType', 'any')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${config.matchType === 'any'
                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                >
                    Match ANY (OR)
                </button>
            </div>

            <div className="flex gap-2 flex-wrap">
                {CONDITION_GROUPS.map(group => (
                    <button
                        key={group.id}
                        type="button"
                        onClick={() => setActiveGroup(group.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${activeGroup === group.id
                            ? 'bg-blue-50 text-blue-700 border border-blue-300'
                            : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
                            }`}
                    >
                        <span>{group.icon}</span>
                        {group.label}
                    </button>
                ))}
            </div>

            <div className="border rounded-lg p-3 bg-gray-50 max-h-[200px] overflow-y-auto">
                <div className="text-xs text-gray-500 mb-2">Select a condition to add:</div>
                <div className="space-y-1">
                    {availableConditions.map(cond => (
                        <button
                            key={cond.field}
                            type="button"
                            onClick={() => {
                                if (conditions[conditions.length - 1]?.field === '') {
                                    const updated = [...conditions];
                                    updated[conditions.length - 1] = {
                                        ...updated[conditions.length - 1],
                                        field: cond.field,
                                        operator: cond.operators[0],
                                    };
                                    setConditions(updated);
                                    onUpdate('conditions', updated);
                                } else {
                                    const newCond: ConditionRule = { field: cond.field, operator: cond.operators[0], value: '' };
                                    const updated = [...conditions, newCond];
                                    setConditions(updated);
                                    onUpdate('conditions', updated);
                                }
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-white rounded-lg transition-colors flex items-center gap-2"
                        >
                            <span className="text-gray-400">+</span>
                            {cond.label}
                        </button>
                    ))}
                </div>
            </div>

            {conditions.filter(c => c.field).length > 0 && (
                <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-700">Active conditions:</div>
                    {conditions.map((cond, idx) => cond.field && (
                        <div key={idx} className="flex items-center gap-2 p-3 bg-white border rounded-lg">
                            <div className="flex-1 grid grid-cols-3 gap-2">
                                <div className="text-sm text-gray-700 font-medium truncate">
                                    {CONDITION_GROUPS.flatMap(g => g.conditions).find(c => c.field === cond.field)?.label || cond.field}
                                </div>
                                <select
                                    value={cond.operator}
                                    onChange={(e) => updateCondition(idx, 'operator', e.target.value)}
                                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                                >
                                    {getOperatorsForField(cond.field).map(op => (
                                        <option key={op} value={op}>{OPERATOR_LABELS[op] || op}</option>
                                    ))}
                                </select>
                                {OPERATORS_WITHOUT_VALUE.has(cond.operator)
                                    ? <div className="text-xs text-gray-500 px-2 py-1">No value required</div>
                                    : renderConditionValueInput(cond, idx)}
                            </div>
                            <button
                                type="button"
                                onClick={() => removeCondition(idx)}
                                className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                            >
                                x
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {conditions.filter((c) => c.field && conditionHasRequiredValue(c)).length > 0 && (
                <div className="bg-orange-50 p-3 rounded-lg text-sm text-orange-700 border border-orange-200">
                    <strong>Preview:</strong><br />
                    If {conditions.filter((c) => c.field && conditionHasRequiredValue(c)).map((c, i) => (
                        <span key={i}>
                            {i > 0 && <span className="font-medium"> {config.matchType === 'any' ? 'OR' : 'AND'} </span>}
                            {CONDITION_GROUPS.flatMap(g => g.conditions).find(cond => cond.field === c.field)?.label || c.field} {OPERATOR_LABELS[c.operator] || c.operator}{OPERATORS_WITHOUT_VALUE.has(c.operator) ? '' : ` "${escapePreviewValue(getConditionValueLabel(c))}"`}
                        </span>
                    ))} {'->'} <span className="text-green-600 font-medium">YES</span><br />
                    Otherwise {'->'} <span className="text-red-600 font-medium">NO</span>
                </div>
            )}

            <button
                type="button"
                onClick={addCondition}
                className="w-full px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
            >
                + Add Another Condition
            </button>
        </div>
    );
};
