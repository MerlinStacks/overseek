/**
 * ActionConfig - Configuration panel for flow action nodes.
 * Extracted from NodeConfigPanel for modularity.
 */
import React from 'react';
import { SendEmailConfig } from '../SendEmailConfig';

interface ActionNodeConfig {
    actionType?: 'SEND_EMAIL' | 'SEND_SMS' | 'ADD_TAG' | 'REMOVE_TAG' | 'WEBHOOK' | 'GENERATE_COUPON' | 'ADD_ORDER_NOTE' | 'UPDATE_ORDER_STATUS';
    smsMessage?: string;
    isTransactional?: boolean;
    tagName?: string;
    webhookUrl?: string;
    codePrefix?: string;
    amount?: string | number;
    discountType?: 'percent' | 'fixed_cart';
    expiryDays?: string | number;
    description?: string;
    individualUse?: boolean;
    noteContent?: string;
    customerVisible?: boolean;
    orderStatus?: string;
    [key: string]: unknown;
}

export interface ActionConfigProps {
    config: ActionNodeConfig;
    onUpdate: (key: string, value: unknown) => void;
}

const ACTION_TYPES = [
    { value: 'SEND_EMAIL', label: 'Send Email' },
    { value: 'SEND_SMS', label: 'Send SMS' },
    { value: 'GENERATE_COUPON', label: 'Generate Coupon' },
    { value: 'ADD_ORDER_NOTE', label: 'Add Order Note' },
    { value: 'UPDATE_ORDER_STATUS', label: 'Update Order Status' },
    { value: 'ADD_TAG', label: 'Add Tag' },
    { value: 'REMOVE_TAG', label: 'Remove Tag' },
    { value: 'WEBHOOK', label: 'Webhook' },
];

export const ActionConfig: React.FC<ActionConfigProps> = ({ config, onUpdate }) => {
    return (
        <>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Action Type</label>
                <select
                    value={config.actionType || 'SEND_EMAIL'}
                    onChange={(e) => onUpdate('actionType', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                    {ACTION_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                </select>
            </div>

            {config.actionType === 'SEND_EMAIL' && (
                <SendEmailConfig config={config} onUpdate={onUpdate} />
            )}

            {config.actionType === 'SEND_SMS' && (
                <>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">SMS Message</label>
                        <textarea
                            value={config.smsMessage || ''}
                            onChange={(e) => onUpdate('smsMessage', e.target.value)}
                            placeholder="Hi {{customer.firstName}}, thanks for your order!"
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="text-xs text-gray-500 mt-1">Use {"{{variable}}"} for personalization</p>
                    </div>
                    {/* Mark as Transactional */}
                    <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                        <label className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                checked={config.isTransactional || false}
                                onChange={(e) => onUpdate('isTransactional', e.target.checked)}
                                className="w-4 h-4 rounded-sm text-yellow-600"
                            />
                            <div>
                                <span className="text-sm font-medium text-yellow-800">Mark as Transactional</span>
                                <p className="text-xs text-yellow-700">Transactional SMS are sent to all contacts, including unsubscribed</p>
                            </div>
                        </label>
                    </div>
                </>
            )}

            {config.actionType === 'ADD_TAG' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tag Name</label>
                    <input
                        type="text"
                        value={config.tagName || ''}
                        onChange={(e) => onUpdate('tagName', e.target.value)}
                        placeholder="VIP Customer"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">This tag will be added to the contact</p>
                </div>
            )}

            {config.actionType === 'REMOVE_TAG' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tag Name</label>
                    <input
                        type="text"
                        value={config.tagName || ''}
                        onChange={(e) => onUpdate('tagName', e.target.value)}
                        placeholder="Abandoned Cart"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">This tag will be removed from the contact</p>
                </div>
            )}

            {config.actionType === 'WEBHOOK' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
                    <input
                        type="url"
                        value={config.webhookUrl || ''}
                        onChange={(e) => onUpdate('webhookUrl', e.target.value)}
                        placeholder="https://example.com/webhook"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                </div>
            )}

            {config.actionType === 'GENERATE_COUPON' && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Discount Type</label>
                            <select
                                value={config.discountType || 'percent'}
                                onChange={(e) => onUpdate('discountType', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="percent">Percent</option>
                                <option value="fixed_cart">Fixed Cart Amount</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={config.amount || 10}
                                onChange={(e) => onUpdate('amount', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Code Prefix</label>
                            <input
                                type="text"
                                value={config.codePrefix || 'OS'}
                                onChange={(e) => onUpdate('codePrefix', e.target.value)}
                                placeholder="WINBACK"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Expiry (Days)</label>
                            <input
                                type="number"
                                min="1"
                                value={config.expiryDays || 7}
                                onChange={(e) => onUpdate('expiryDays', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                        <input
                            type="text"
                            value={config.description || ''}
                            onChange={(e) => onUpdate('description', e.target.value)}
                            placeholder="Special recovery offer"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                        <label className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                checked={config.individualUse ?? true}
                                onChange={(e) => onUpdate('individualUse', e.target.checked)}
                                className="w-4 h-4 rounded-sm text-blue-600"
                            />
                            <div>
                                <span className="text-sm font-medium text-blue-800">One customer use only</span>
                                <p className="text-xs text-blue-700">Restrict the coupon to one use and the enrolled email address.</p>
                            </div>
                        </label>
                    </div>
                </div>
            )}

            {config.actionType === 'ADD_ORDER_NOTE' && (
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Order Note</label>
                        <textarea
                            value={config.noteContent || ''}
                            onChange={(e) => onUpdate('noteContent', e.target.value)}
                            placeholder="Order updated by automation for {{customer.email}}"
                            rows={4}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="text-xs text-gray-500 mt-1">Supports merge tags from the current automation context.</p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <label className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                checked={config.customerVisible || false}
                                onChange={(e) => onUpdate('customerVisible', e.target.checked)}
                                className="w-4 h-4 rounded-sm"
                            />
                            <div>
                                <span className="text-sm font-medium text-slate-800">Show as customer note</span>
                                <p className="text-xs text-slate-600">If enabled, the note is visible to the customer in WooCommerce.</p>
                            </div>
                        </label>
                    </div>
                </div>
            )}

            {config.actionType === 'UPDATE_ORDER_STATUS' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Target Order Status</label>
                    <select
                        value={config.orderStatus || 'processing'}
                        onChange={(e) => onUpdate('orderStatus', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
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
        </>
    );
};
