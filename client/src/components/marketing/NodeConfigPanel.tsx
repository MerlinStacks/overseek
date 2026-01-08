/**
 * NodeConfigPanel - Slide-out configuration panel for flow nodes.
 * Opens when a node is selected, showing type-specific configuration options.
 */
import React, { useState, useEffect } from 'react';
import { Node } from '@xyflow/react';
import { X, Trash2, Zap, Mail, Clock, Split, Save } from 'lucide-react';

interface NodeConfigPanelProps {
    node: Node | null;
    onClose: () => void;
    onUpdate: (nodeId: string, data: any) => void;
    onDelete: (nodeId: string) => void;
}

export const NodeConfigPanel: React.FC<NodeConfigPanelProps> = ({
    node,
    onClose,
    onUpdate,
    onDelete
}) => {
    const [localData, setLocalData] = useState<any>({});

    // Sync local state when node changes
    useEffect(() => {
        if (node) {
            setLocalData({ ...node.data });
        }
    }, [node]);

    if (!node) return null;

    const handleSave = () => {
        onUpdate(node.id, localData);
    };

    const handleDelete = () => {
        if (confirm('Delete this node?')) {
            onDelete(node.id);
        }
    };

    const updateConfig = (key: string, value: any) => {
        setLocalData((prev: any) => ({
            ...prev,
            config: { ...prev.config, [key]: value }
        }));
    };

    const updateLabel = (label: string) => {
        setLocalData((prev: any) => ({ ...prev, label }));
    };

    // Get panel title and icon based on node type
    const getPanelHeader = () => {
        switch (node.type) {
            case 'trigger':
                return { title: 'Configure Trigger', icon: <Zap size={18} className="text-blue-600" />, color: 'blue' };
            case 'action':
                return { title: 'Configure Action', icon: <Mail size={18} className="text-green-600" />, color: 'green' };
            case 'delay':
                return { title: 'Configure Delay', icon: <Clock size={18} className="text-yellow-600" />, color: 'yellow' };
            case 'condition':
                return { title: 'Configure Condition', icon: <Split size={18} className="text-orange-600" />, color: 'orange' };
            default:
                return { title: 'Configure Node', icon: null, color: 'gray' };
        }
    };

    const header = getPanelHeader();

    return (
        <aside className="w-80 bg-white border-l border-gray-200 flex flex-col h-full shadow-lg z-20">
            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-3 border-b bg-${header.color}-50`}>
                <div className="flex items-center gap-2">
                    {header.icon}
                    <h3 className="font-semibold text-gray-900">{header.title}</h3>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-gray-200 rounded"
                >
                    <X size={18} className="text-gray-500" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Common: Label */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
                    <input
                        type="text"
                        value={localData.label || ''}
                        onChange={(e) => updateLabel(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>

                {/* Trigger-specific config */}
                {node.type === 'trigger' && (
                    <TriggerConfig
                        config={localData.config || {}}
                        onUpdate={updateConfig}
                    />
                )}

                {/* Action-specific config */}
                {node.type === 'action' && (
                    <ActionConfig
                        config={localData.config || {}}
                        onUpdate={updateConfig}
                    />
                )}

                {/* Delay-specific config */}
                {node.type === 'delay' && (
                    <DelayConfig
                        config={localData.config || {}}
                        onUpdate={updateConfig}
                    />
                )}

                {/* Condition-specific config */}
                {node.type === 'condition' && (
                    <ConditionConfig
                        config={localData.config || {}}
                        onUpdate={updateConfig}
                    />
                )}
            </div>

            {/* Footer Actions */}
            <div className="border-t p-4 flex justify-between">
                <button
                    onClick={handleDelete}
                    className="flex items-center gap-1 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium"
                >
                    <Trash2 size={16} />
                    Delete
                </button>
                <button
                    onClick={handleSave}
                    className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                >
                    <Save size={16} />
                    Apply Changes
                </button>
            </div>
        </aside>
    );
};

// --- Trigger Configuration ---
interface TriggerConfigProps {
    config: any;
    onUpdate: (key: string, value: any) => void;
}

const TriggerConfig: React.FC<TriggerConfigProps> = ({ config, onUpdate }) => {
    const triggerTypes = [
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

    return (
        <>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trigger Type</label>
                <select
                    value={config.triggerType || 'ORDER_CREATED'}
                    onChange={(e) => onUpdate('triggerType', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                    {triggerTypes.map(t => (
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
                            className="rounded"
                        />
                        <label htmlFor="filterByValue" className="text-sm text-gray-600">Filter by order value</label>
                    </div>
                    {config.filterByValue && (
                        <div className="flex items-center gap-2 ml-6">
                            <span className="text-sm text-gray-600">Order total</span>
                            <select
                                value={config.filterOperator || 'gt'}
                                onChange={(e) => onUpdate('filterOperator', e.target.value)}
                                className="px-2 py-1 border rounded text-sm"
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
                                className="w-20 px-2 py-1 border rounded text-sm"
                            />
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

// --- Action Configuration ---
interface ActionConfigProps {
    config: any;
    onUpdate: (key: string, value: any) => void;
}

const ActionConfig: React.FC<ActionConfigProps> = ({ config, onUpdate }) => {
    const actionTypes = [
        { value: 'SEND_EMAIL', label: 'Send Email' },
        { value: 'SEND_SMS', label: 'Send SMS' },
        { value: 'ADD_TAG', label: 'Add Tag' },
        { value: 'REMOVE_TAG', label: 'Remove Tag' },
        { value: 'WEBHOOK', label: 'Webhook' },
    ];

    return (
        <>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Action Type</label>
                <select
                    value={config.actionType || 'SEND_EMAIL'}
                    onChange={(e) => onUpdate('actionType', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                    {actionTypes.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                </select>
            </div>

            {config.actionType === 'SEND_EMAIL' && (
                <>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Subject Line</label>
                        <input
                            type="text"
                            value={config.subject || ''}
                            onChange={(e) => onUpdate('subject', e.target.value)}
                            placeholder="Thanks for your order!"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email Template</label>
                        <select
                            value={config.templateId || ''}
                            onChange={(e) => onUpdate('templateId', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">Select a template...</option>
                            <option value="order_confirmation">Order Confirmation</option>
                            <option value="thank_you">Thank You</option>
                            <option value="review_request">Review Request</option>
                            <option value="abandoned_cart">Abandoned Cart Reminder</option>
                        </select>
                    </div>
                </>
            )}

            {config.actionType === 'SEND_SMS' && (
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
        </>
    );
};

// --- Delay Configuration ---
interface DelayConfigProps {
    config: any;
    onUpdate: (key: string, value: any) => void;
}

const DelayConfig: React.FC<DelayConfigProps> = ({ config, onUpdate }) => {
    const delayMode = config.delayMode || 'SPECIFIC_PERIOD';
    const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    const toggleDay = (day: string) => {
        const current = config.delayUntilDays || [];
        if (current.includes(day)) {
            onUpdate('delayUntilDays', current.filter((d: string) => d !== day));
        } else {
            onUpdate('delayUntilDays', [...current, day]);
        }
    };

    return (
        <div className="space-y-4">
            {/* Delay Mode Selector */}
            <div className="space-y-2">
                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                    <input
                        type="radio"
                        name="delayMode"
                        value="SPECIFIC_PERIOD"
                        checked={delayMode === 'SPECIFIC_PERIOD'}
                        onChange={() => onUpdate('delayMode', 'SPECIFIC_PERIOD')}
                        className="w-4 h-4 text-blue-600"
                    />
                    <div>
                        <div className="font-medium text-gray-900">Delay for a specific period</div>
                        <div className="text-xs text-gray-500">Wait for a specified number of hours, days, or weeks before continuing</div>
                    </div>
                </label>

                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                    <input
                        type="radio"
                        name="delayMode"
                        value="SPECIFIC_DATE"
                        checked={delayMode === 'SPECIFIC_DATE'}
                        onChange={() => onUpdate('delayMode', 'SPECIFIC_DATE')}
                        className="w-4 h-4 text-blue-600"
                    />
                    <div>
                        <div className="font-medium text-gray-900">Delay until a specific date and time</div>
                        <div className="text-xs text-gray-500">Set a specific date and time</div>
                    </div>
                </label>

                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                    <input
                        type="radio"
                        name="delayMode"
                        value="CUSTOM_FIELD"
                        checked={delayMode === 'CUSTOM_FIELD'}
                        onChange={() => onUpdate('delayMode', 'CUSTOM_FIELD')}
                        className="w-4 h-4 text-blue-600"
                    />
                    <div>
                        <div className="font-medium text-gray-900">Delay until a custom field date</div>
                        <div className="text-xs text-gray-500">Choose from contacts custom field</div>
                    </div>
                </label>
            </div>

            {/* Specific Period Options */}
            {delayMode === 'SPECIFIC_PERIOD' && (
                <div className="space-y-3 p-3 bg-gray-50 rounded-lg border">
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min="1"
                            value={config.duration || 1}
                            onChange={(e) => onUpdate('duration', parseInt(e.target.value) || 1)}
                            className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                        <select
                            value={config.unit || 'hours'}
                            onChange={(e) => onUpdate('unit', e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="minutes">Minutes</option>
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                            <option value="weeks">Weeks</option>
                        </select>
                    </div>

                    {/* Time of day constraint */}
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={config.delayUntilTimeEnabled || false}
                            onChange={(e) => onUpdate('delayUntilTimeEnabled', e.target.checked)}
                            className="rounded"
                        />
                        <span className="text-sm text-gray-600">Delay until a specific time of day</span>
                    </label>
                    {config.delayUntilTimeEnabled && (
                        <input
                            type="time"
                            value={config.delayUntilTime || '09:00'}
                            onChange={(e) => onUpdate('delayUntilTime', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                    )}

                    {/* Day of week constraint */}
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={config.delayUntilDaysEnabled || false}
                            onChange={(e) => onUpdate('delayUntilDaysEnabled', e.target.checked)}
                            className="rounded"
                        />
                        <span className="text-sm text-gray-600">Delay until a specific day(s) of the week</span>
                    </label>
                    {config.delayUntilDaysEnabled && (
                        <div className="flex flex-wrap gap-1">
                            {daysOfWeek.map(day => (
                                <button
                                    key={day}
                                    type="button"
                                    onClick={() => toggleDay(day)}
                                    className={`px-2 py-1 text-xs rounded ${(config.delayUntilDays || []).includes(day)
                                        ? 'bg-blue-500 text-white'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                        }`}
                                >
                                    {day}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Summary pill */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                        <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-[10px] font-bold">i</span>
                        </div>
                        <span className="text-xs text-blue-700">
                            Delay of {config.duration || 1} {config.unit || 'hours'}.
                            {config.delayUntilTimeEnabled && ` Until ${config.delayUntilTime || '09:00'}.`}
                            {config.delayUntilDaysEnabled && (config.delayUntilDays?.length > 0) && ` On ${config.delayUntilDays.join(', ')}.`}
                        </span>
                    </div>
                </div>
            )}

            {/* Specific Date Options */}
            {delayMode === 'SPECIFIC_DATE' && (
                <div className="p-3 bg-gray-50 rounded-lg border">
                    <input
                        type="datetime-local"
                        value={config.specificDate || ''}
                        onChange={(e) => onUpdate('specificDate', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                </div>
            )}

            {/* Custom Field Options */}
            {delayMode === 'CUSTOM_FIELD' && (
                <div className="p-3 bg-gray-50 rounded-lg border">
                    <select
                        value={config.customFieldKey || ''}
                        onChange={(e) => onUpdate('customFieldKey', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">Select a date field...</option>
                        <option value="birthday">Birthday</option>
                        <option value="subscription_renewal">Subscription Renewal</option>
                        <option value="last_order_date">Last Order Date</option>
                    </select>
                </div>
            )}
        </div>
    );
};

// --- Condition Configuration ---
interface ConditionConfigProps {
    config: any;
    onUpdate: (key: string, value: any) => void;
}

const ConditionConfig: React.FC<ConditionConfigProps> = ({ config, onUpdate }) => {
    const fields = [
        { value: 'customer.totalSpent', label: 'Customer Total Spent' },
        { value: 'customer.ordersCount', label: 'Customer Order Count' },
        { value: 'order.total', label: 'Order Total' },
        { value: 'order.itemCount', label: 'Order Item Count' },
        { value: 'customer.tags', label: 'Customer Tags' },
    ];

    const operators = [
        { value: 'eq', label: 'equals' },
        { value: 'neq', label: 'not equals' },
        { value: 'gt', label: 'greater than' },
        { value: 'gte', label: 'greater than or equal' },
        { value: 'lt', label: 'less than' },
        { value: 'lte', label: 'less than or equal' },
        { value: 'contains', label: 'contains' },
    ];

    return (
        <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">Condition Rule</label>

            <div>
                <label className="block text-xs text-gray-500 mb-1">Field</label>
                <select
                    value={config.field || 'customer.totalSpent'}
                    onChange={(e) => onUpdate('field', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                >
                    {fields.map(f => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                </select>
            </div>

            <div>
                <label className="block text-xs text-gray-500 mb-1">Operator</label>
                <select
                    value={config.operator || 'gt'}
                    onChange={(e) => onUpdate('operator', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                >
                    {operators.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </div>

            <div>
                <label className="block text-xs text-gray-500 mb-1">Value</label>
                <input
                    type="text"
                    value={config.value || ''}
                    onChange={(e) => onUpdate('value', e.target.value)}
                    placeholder="100"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                />
            </div>

            <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-600 border">
                <strong>Preview:</strong><br />
                If {config.field || 'customer.totalSpent'} {config.operator || 'gt'} {config.value || '...'} → YES branch<br />
                Otherwise → NO branch
            </div>
        </div>
    );
};
