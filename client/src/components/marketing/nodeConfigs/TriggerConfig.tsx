/**
 * TriggerConfig - Configuration panel for flow trigger nodes.
 * Extracted from NodeConfigPanel for modularity.
 */
import React from 'react';

interface TriggerNodeConfig {
    triggerType?: string;
    filterByValue?: boolean;
    filterOperator?: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
    filterValue?: string | number;
    daysWithoutPurchase?: number;
    targetOrderStatus?: string;
    frequencyCapHours?: number;
    accountWideEmailCapHours?: number;
    quietHoursEnabled?: boolean;
    quietHoursStart?: number;
    quietHoursEnd?: number;
}

export interface TriggerConfigProps {
    config: TriggerNodeConfig;
    onUpdate: (key: string, value: unknown) => void;
}

const TRIGGER_TYPES = [
    { value: 'ORDER_CREATED', label: 'Order Created', group: 'WooCommerce' },
    { value: 'ORDER_PAID', label: 'Order Paid', group: 'WooCommerce' },
    { value: 'ORDER_COMPLETED', label: 'Order Completed', group: 'WooCommerce' },
    { value: 'ORDER_STATUS_CHANGED', label: 'Order Status Changed', group: 'WooCommerce' },
    { value: 'FIRST_ORDER', label: 'First Order', group: 'WooCommerce' },
    { value: 'ABANDONED_CART', label: 'Cart Abandoned', group: 'WooCommerce' },
    { value: 'CART_VIEWED', label: 'Cart Viewed', group: 'WooCommerce' },
    { value: 'REVIEW_LEFT', label: 'Review Left', group: 'WooCommerce' },
    { value: 'CUSTOMER_CREATED', label: 'Customer Created', group: 'Customer' },
    { value: 'NO_PURCHASE_IN_X_DAYS', label: 'No Purchase In X Days', group: 'Customer' },
    { value: 'TAG_ADDED', label: 'Tag Added', group: 'Customer' },
    { value: 'TAG_REMOVED', label: 'Tag Removed', group: 'Customer' },
    { value: 'MANUAL', label: 'Manual Entry', group: 'Customer' },
    { value: 'SUBSCRIPTION_CREATED', label: 'Subscription Created', group: 'Subscriptions' },
    { value: 'SUBSCRIPTION_CANCELLED', label: 'Subscription Cancelled', group: 'Subscriptions' },
    { value: 'EMAIL_OPENED', label: 'Email Opened', group: 'Email Engagement' },
    { value: 'LINK_CLICKED', label: 'Link Clicked', group: 'Email Engagement' },
];

export const TriggerConfig: React.FC<TriggerConfigProps> = ({ config, onUpdate }) => {
    const selectedTrigger = config.triggerType || 'ORDER_CREATED';
    const supportsValueFilter = [
        'ORDER_CREATED',
        'ORDER_PAID',
        'ORDER_COMPLETED',
        'FIRST_ORDER',
        'ABANDONED_CART'
    ].includes(selectedTrigger);

    return (
        <>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trigger Type</label>
                <select
                    value={selectedTrigger}
                    onChange={(e) => onUpdate('triggerType', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                    {TRIGGER_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                </select>
            </div>

            {selectedTrigger === 'NO_PURCHASE_IN_X_DAYS' && (
                <div className="border-t pt-4 space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Lifecycle Window</label>
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">Trigger when no purchase has happened for</span>
                        <input
                            type="number"
                            min={1}
                            value={config.daysWithoutPurchase || 90}
                            onChange={(e) => onUpdate('daysWithoutPurchase', Number(e.target.value) || 90)}
                            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <span className="text-sm text-gray-600">days</span>
                    </div>
                </div>
            )}

            {selectedTrigger === 'ORDER_STATUS_CHANGED' && (
                <div className="border-t pt-4 space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Target Status</label>
                    <select
                        value={config.targetOrderStatus || ''}
                        onChange={(e) => onUpdate('targetOrderStatus', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">Any status change</option>
                        <option value="pending">Pending</option>
                        <option value="processing">Processing</option>
                        <option value="on-hold">On Hold</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                        <option value="refunded">Refunded</option>
                        <option value="failed">Failed</option>
                    </select>
                </div>
            )}

            {supportsValueFilter && (
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
                                    <option value="gte">&gt;=</option>
                                    <option value="lt">&lt;</option>
                                    <option value="lte">&lt;=</option>
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
            )}

            <div className="border-t pt-4 space-y-2">
                <label className="block text-sm font-medium text-gray-700">Frequency Cap</label>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Do not re-enroll this customer again for</span>
                    <input
                        type="number"
                        min={0}
                        value={config.frequencyCapHours || 0}
                        onChange={(e) => onUpdate('frequencyCapHours', Number(e.target.value) || 0)}
                        className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <span className="text-sm text-gray-600">hours</span>
                </div>
                <p className="text-xs text-gray-500">Use `0` to allow immediate re-entry when other dedupe rules permit it.</p>
            </div>

            <div className="border-t pt-4 space-y-2">
                <label className="block text-sm font-medium text-gray-700">Account-Wide Email Cooldown</label>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Do not send another automation email to this customer for</span>
                    <input
                        type="number"
                        min={0}
                        value={config.accountWideEmailCapHours || 0}
                        onChange={(e) => onUpdate('accountWideEmailCapHours', Number(e.target.value) || 0)}
                        className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <span className="text-sm text-gray-600">hours across all flows</span>
                </div>
                <p className="text-xs text-gray-500">Uses actual automation email send history for this account and delays the next email step until the cooldown expires.</p>
            </div>

            <div className="border-t pt-4 space-y-3">
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        id="quietHoursEnabled"
                        checked={config.quietHoursEnabled || false}
                        onChange={(e) => onUpdate('quietHoursEnabled', e.target.checked)}
                        className="rounded-sm"
                    />
                    <label htmlFor="quietHoursEnabled" className="text-sm font-medium text-gray-700">Respect quiet hours for email sends</label>
                </div>

                {config.quietHoursEnabled && (
                    <>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">Pause sends from</span>
                            <input
                                type="number"
                                min={0}
                                max={23}
                                value={config.quietHoursStart ?? 21}
                                onChange={(e) => onUpdate('quietHoursStart', Number(e.target.value) || 0)}
                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                            <span className="text-sm text-gray-600">to</span>
                            <input
                                type="number"
                                min={0}
                                max={23}
                                value={config.quietHoursEnd ?? 8}
                                onChange={(e) => onUpdate('quietHoursEnd', Number(e.target.value) || 0)}
                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                            <span className="text-sm text-gray-600">local store time</span>
                        </div>
                        <p className="text-xs text-gray-500">Uses the account timezone and will hold email action steps until the next allowed hour.</p>
                    </>
                )}
            </div>
        </>
    );
};
