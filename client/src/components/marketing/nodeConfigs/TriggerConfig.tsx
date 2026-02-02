/**
 * TriggerConfig - Configuration panel for flow trigger nodes.
 * Extracted from NodeConfigPanel for modularity.
 */
import React from 'react';

export interface TriggerConfigProps {
    config: any;
    onUpdate: (key: string, value: any) => void;
}

const TRIGGER_TYPES = [
    { value: 'ORDER_CREATED', label: 'Order Created', group: 'WooCommerce' },
    { value: 'ORDER_COMPLETED', label: 'Order Completed', group: 'WooCommerce' },
    { value: 'ABANDONED_CART', label: 'Cart Abandoned', group: 'WooCommerce' },
    { value: 'CART_VIEWED', label: 'Cart Viewed', group: 'WooCommerce' },
    { value: 'REVIEW_LEFT', label: 'Review Left', group: 'WooCommerce' },
    { value: 'CUSTOMER_SIGNUP', label: 'Customer Signup', group: 'Customer' },
    { value: 'TAG_ADDED', label: 'Tag Added', group: 'Customer' },
    { value: 'TAG_REMOVED', label: 'Tag Removed', group: 'Customer' },
    { value: 'MANUAL', label: 'Manual Entry', group: 'Customer' },
    { value: 'SUBSCRIPTION_CREATED', label: 'Subscription Created', group: 'Subscriptions' },
    { value: 'SUBSCRIPTION_CANCELLED', label: 'Subscription Cancelled', group: 'Subscriptions' },
    { value: 'EMAIL_OPENED', label: 'Email Opened', group: 'Email Engagement' },
    { value: 'LINK_CLICKED', label: 'Link Clicked', group: 'Email Engagement' },
];

export const TriggerConfig: React.FC<TriggerConfigProps> = ({ config, onUpdate }) => {
    return (
        <>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trigger Type</label>
                <select
                    value={config.triggerType || 'ORDER_CREATED'}
                    onChange={(e) => onUpdate('triggerType', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                    {TRIGGER_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                </select>
            </div>

            <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Conditions (Optional)</label>
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="filterByValue"
                            checked={config.filterByValue || false}
                            onChange={(e) => onUpdate('filterByValue', e.target.checked)}
                            className="rounded-sm"
                        />
                        <label htmlFor="filterByValue" className="text-sm text-gray-600">Filter by order value</label>
                    </div>
                    {config.filterByValue && (
                        <div className="flex items-center gap-2 ml-6">
                            <span className="text-sm text-gray-600">Order total</span>
                            <select
                                value={config.filterOperator || 'gt'}
                                onChange={(e) => onUpdate('filterOperator', e.target.value)}
                                className="px-2 py-1 border rounded-sm text-sm"
                            >
                                <option value="gt">&gt;</option>
                                <option value="gte">≥</option>
                                <option value="lt">&lt;</option>
                                <option value="lte">≤</option>
                                <option value="eq">=</option>
                            </select>
                            <span className="text-sm text-gray-600">$</span>
                            <input
                                type="number"
                                value={config.filterValue || ''}
                                onChange={(e) => onUpdate('filterValue', e.target.value)}
                                placeholder="100"
                                className="w-20 px-2 py-1 border rounded-sm text-sm"
                            />
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};
