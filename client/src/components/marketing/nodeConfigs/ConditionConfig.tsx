/**
 * ConditionConfig - Configuration panel for flow condition nodes.
 * Extracted from NodeConfigPanel for modularity.
 */
import React, { useState, useEffect } from 'react';

export interface ConditionConfigProps {
    config: any;
    onUpdate: (key: string, value: any) => void;
}

/** Condition group definitions matching FunnelKit pattern */
export const CONDITION_GROUPS = [
    {
        id: 'segments',
        label: 'Segments',
        icon: '📋',
        conditions: [
            { field: 'segment.id', label: 'Contact is in Segment', operators: ['eq', 'neq'] },
            { field: 'list.id', label: 'Contact is in List', operators: ['eq', 'neq'] },
        ]
    },
    {
        id: 'contact',
        label: 'Contact Details',
        icon: '👤',
        conditions: [
            { field: 'customer.email', label: 'Email address', operators: ['contains', 'not_contains', 'eq', 'neq'] },
            { field: 'customer.phone', label: 'Phone number', operators: ['is_set', 'not_set', 'eq'] },
            { field: 'customer.firstName', label: 'First name', operators: ['eq', 'neq', 'contains'] },
            { field: 'customer.lastName', label: 'Last name', operators: ['eq', 'neq', 'contains'] },
            { field: 'customer.tags', label: 'Has tag', operators: ['contains', 'not_contains'] },
        ]
    },
    {
        id: 'woocommerce',
        label: 'WooCommerce',
        icon: '🛒',
        conditions: [
            { field: 'order.total', label: 'Order Total', operators: ['gt', 'gte', 'lt', 'lte', 'eq'] },
            { field: 'order.itemCount', label: 'Order Item Count', operators: ['gt', 'gte', 'lt', 'lte', 'eq'] },
            { field: 'order.productId', label: 'Order contains product', operators: ['eq', 'neq'] },
            { field: 'order.categoryId', label: 'Order contains category', operators: ['eq', 'neq'] },
            { field: 'customer.totalSpent', label: 'Customer Lifetime Value', operators: ['gt', 'gte', 'lt', 'lte'] },
            { field: 'customer.ordersCount', label: 'Customer Total Orders', operators: ['gt', 'gte', 'lt', 'lte', 'eq'] },
        ]
    },
    {
        id: 'user',
        label: 'User',
        icon: '🔐',
        conditions: [
            { field: 'user.role', label: 'User Role', operators: ['eq', 'neq'] },
            { field: 'user.isLoggedIn', label: 'Is Logged In', operators: ['eq'] },
            { field: 'user.registeredDays', label: 'Days since registration', operators: ['gt', 'lt', 'eq'] },
        ]
    },
    {
        id: 'geography',
        label: 'Geography',
        icon: '🌍',
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
        icon: '📧',
        conditions: [
            { field: 'email.opened', label: 'Opened any email', operators: ['eq'] },
            { field: 'email.openedRecent', label: 'Opened email in last X days', operators: ['eq'] },
            { field: 'email.clicked', label: 'Clicked any link', operators: ['eq'] },
            { field: 'email.clickedRecent', label: 'Clicked link in last X days', operators: ['eq'] },
        ]
    },
    {
        id: 'datetime',
        label: 'DateTime',
        icon: '📅',
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

export const ConditionConfig: React.FC<ConditionConfigProps> = ({ config, onUpdate }) => {
    const [activeGroup, setActiveGroup] = useState(config.group || 'woocommerce');
    const [conditions, setConditions] = useState<any[]>(config.conditions || [{ field: '', operator: '', value: '' }]);

    // Find available conditions for active group
    const activeGroupData = CONDITION_GROUPS.find(g => g.id === activeGroup);
    const availableConditions = activeGroupData?.conditions || [];

    // Get operators for a field
    const getOperatorsForField = (fieldValue: string) => {
        for (const group of CONDITION_GROUPS) {
            const condition = group.conditions.find(c => c.field === fieldValue);
            if (condition) {
                return condition.operators;
            }
        }
        return ['eq', 'neq', 'gt', 'lt'];
    };

    const updateCondition = (index: number, key: string, value: any) => {
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

    // Sync group to config
    useEffect(() => {
        onUpdate('group', activeGroup);
    }, [activeGroup]);

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Add Conditions</label>
                <span className="text-xs text-gray-500">Match {config.matchType || 'all'} conditions</span>
            </div>

            {/* Match Type Toggle */}
            <div className="flex gap-2">
                <button
                    onClick={() => onUpdate('matchType', 'all')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${(config.matchType || 'all') === 'all'
                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                >
                    Match ALL (AND)
                </button>
                <button
                    onClick={() => onUpdate('matchType', 'any')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${config.matchType === 'any'
                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                >
                    Match ANY (OR)
                </button>
            </div>

            {/* Category Selector */}
            <div className="flex gap-2 flex-wrap">
                {CONDITION_GROUPS.map(group => (
                    <button
                        key={group.id}
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

            {/* Available Conditions */}
            <div className="border rounded-lg p-3 bg-gray-50 max-h-[200px] overflow-y-auto">
                <div className="text-xs text-gray-500 mb-2">Select a condition to add:</div>
                <div className="space-y-1">
                    {availableConditions.map(cond => (
                        <button
                            key={cond.field}
                            onClick={() => {
                                // Add this condition
                                if (conditions[conditions.length - 1]?.field === '') {
                                    updateCondition(conditions.length - 1, 'field', cond.field);
                                    updateCondition(conditions.length - 1, 'operator', cond.operators[0]);
                                } else {
                                    const newCond = { field: cond.field, operator: cond.operators[0], value: '' };
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

            {/* Active Conditions */}
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
                                <input
                                    type="text"
                                    value={cond.value || ''}
                                    onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                                    placeholder="Value..."
                                    className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                                />
                            </div>
                            <button
                                onClick={() => removeCondition(idx)}
                                className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Preview */}
            {conditions.filter(c => c.field && c.value).length > 0 && (
                <div className="bg-orange-50 p-3 rounded-lg text-sm text-orange-700 border border-orange-200">
                    <strong>Preview:</strong><br />
                    If {conditions.filter(c => c.field && c.value).map((c, i) => (
                        <span key={i}>
                            {i > 0 && <span className="font-medium"> {config.matchType === 'any' ? 'OR' : 'AND'} </span>}
                            {CONDITION_GROUPS.flatMap(g => g.conditions).find(cond => cond.field === c.field)?.label || c.field} {OPERATOR_LABELS[c.operator] || c.operator} "{c.value}"
                        </span>
                    ))} → <span className="text-green-600 font-medium">YES</span><br />
                    Otherwise → <span className="text-red-600 font-medium">NO</span>
                </div>
            )}
        </div>
    );
};
