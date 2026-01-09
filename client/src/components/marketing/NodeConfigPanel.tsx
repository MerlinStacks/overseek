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
                return { title: 'Configure Trigger', subtitle: 'Entry point for this automation', icon: <Zap size={18} className="text-blue-600" />, color: 'blue' };
            case 'action':
                return { title: 'Configure Action', subtitle: 'Perform an action in the flow', icon: <Mail size={18} className="text-green-600" />, color: 'green' };
            case 'delay':
                return { title: 'Configure Delay', subtitle: 'Add a time delay before continuing', icon: <Clock size={18} className="text-yellow-600" />, color: 'yellow' };
            case 'condition':
                return { title: 'Configure Condition', subtitle: 'Branch based on conditions', icon: <Split size={18} className="text-orange-600" />, color: 'orange' };
            default:
                return { title: 'Configure Node', subtitle: 'Configure this step', icon: null, color: 'gray' };
        }
    };

    const header = getPanelHeader();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className={`flex items-center justify-between px-6 py-4 border-b`}>
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg bg-${header.color}-100`}>
                            {header.icon}
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900">{localData.label || header.title}</h3>
                            <p className="text-sm text-gray-500">{header.subtitle}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X size={18} className="text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
                <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
                    <button
                        onClick={handleDelete}
                        className="flex items-center gap-1.5 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors"
                    >
                        <Trash2 size={16} />
                        Delete
                    </button>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
                        >
                            <Save size={16} />
                            Save
                        </button>
                    </div>
                </div>
            </div>
        </div>
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
                    {/* Mark as Transactional */}
                    <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                        <label className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                checked={config.isTransactional || false}
                                onChange={(e) => onUpdate('isTransactional', e.target.checked)}
                                className="w-4 h-4 rounded-sm text-yellow-600"
                            />
                            <div>
                                <span className="text-sm font-medium text-yellow-800">Mark as Transactional</span>
                                <p className="text-xs text-yellow-700">Transactional emails are sent to all contacts, including unsubscribed</p>
                            </div>
                        </label>
                    </div>
                </>
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
            )
            }

            {
                config.actionType === 'REMOVE_TAG' && (
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
                )
            }

            {
                config.actionType === 'WEBHOOK' && (
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
                )
            }
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
                            <option value="months">Months</option>
                        </select>
                    </div>

                    {/* Contact Timezone */}
                    <label className="flex items-center gap-2 p-3 bg-purple-50 rounded-lg border border-purple-100">
                        <input
                            type="checkbox"
                            checked={config.useContactTimezone || false}
                            onChange={(e) => onUpdate('useContactTimezone', e.target.checked)}
                            className="rounded-sm text-purple-600"
                        />
                        <div>
                            <span className="text-sm font-medium text-purple-700">Use contact's timezone</span>
                            <p className="text-xs text-purple-600">Times will be calculated based on the contact's local time</p>
                        </div>
                    </label>

                    {/* Time of day constraint */}
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={config.delayUntilTimeEnabled || false}
                            onChange={(e) => onUpdate('delayUntilTimeEnabled', e.target.checked)}
                            className="rounded-sm"
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
                            className="rounded-sm"
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
                        <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                            <span className="text-white text-[10px] font-bold">i</span>
                        </div>
                        <span className="text-xs text-blue-700">
                            Delay of {config.duration || 1} {config.unit || 'hours'}
                            {config.useContactTimezone && " (contact's timezone)"}
                            {config.delayUntilTimeEnabled && ` until ${config.delayUntilTime || '09:00'}`}
                            {config.delayUntilDaysEnabled && (config.delayUntilDays?.length > 0) && ` on ${config.delayUntilDays.join(', ')}`}.
                        </span>
                    </div>

                    {/* Jump if time passed */}
                    <label className="flex items-center gap-2 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                        <input
                            type="checkbox"
                            checked={config.jumpIfPassed || false}
                            onChange={(e) => onUpdate('jumpIfPassed', e.target.checked)}
                            className="rounded-sm text-yellow-600"
                        />
                        <div>
                            <span className="text-sm font-medium text-yellow-700">Jump to next step if time has passed</span>
                            <p className="text-xs text-yellow-600">If the scheduled time already passed, skip this delay</p>
                        </div>
                    </label>
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

// Condition groups matching FunnelKit pattern
const CONDITION_GROUPS = [
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

const OPERATOR_LABELS: Record<string, string> = {
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

const ConditionConfig: React.FC<ConditionConfigProps> = ({ config, onUpdate }) => {
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

