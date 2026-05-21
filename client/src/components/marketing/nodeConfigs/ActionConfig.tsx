/**
 * ActionConfig - Configuration panel for flow action nodes.
 * Extracted from NodeConfigPanel for modularity.
 */
import React, { useEffect, useState } from 'react';
import { SendEmailConfig } from '../SendEmailConfig';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
import { api } from '../../../services/api';
import { LTR_TEXT_STYLE, sanitizeBidiText } from '../textInputBidi';
import { getSupportedFlowActionIds } from '../flowValidation';

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
    onUpdateMany?: (updates: Record<string, unknown>) => void;
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

const SUPPORTED_ACTION_IDS = getSupportedFlowActionIds();

const GSM_7BIT_REGEX = /^[\r\n @\u00A3$\u00A5\u00E8\u00E9\u00F9\u00EC\u00F2\u00C7\u00D8\u00F8\u00C5\u00E5\u0394_\u03A6\u0393\u039B\u03A9\u03A0\u03A8\u03A3\u0398\u039E\u00C6\u00E6\u00DF\u00C9!"#\u00A4%&'()*+,\-./0-9:;<=>?\u00A1A-Z\u00C4\u00D6\u00D1\u00DC\u00A7\u00BFa-z\u00E4\u00F6\u00F1\u00FC\u00E0^{}\\[~\]|\u20AC]*$/;
const GSM_EXTENDED_REGEX = /[{}\\[~\]|\u20AC^]/g;

const TWILIO_MAX_SMS_LENGTH = 1600;

function getSmsMetrics(message: string) {
    const text = message || '';
    const isGsm = GSM_7BIT_REGEX.test(text);
    const extendedChars = isGsm ? (text.match(GSM_EXTENDED_REGEX)?.length || 0) : 0;
    const effectiveLength = isGsm ? text.length + extendedChars : text.length;
    const singleLimit = isGsm ? 160 : 70;
    const multipartLimit = isGsm ? 153 : 67;
    const length = effectiveLength;

    const segments =
        length === 0
            ? 0
            : length <= singleLimit
                ? 1
                : Math.ceil(length / multipartLimit);

    return {
        rawLength: text.length,
        length,
        segments,
        maxLength: TWILIO_MAX_SMS_LENGTH,
        isGsm,
        overLimit: text.length > TWILIO_MAX_SMS_LENGTH,
    };
}

export const ActionConfig: React.FC<ActionConfigProps> = ({ config, onUpdate, onUpdateMany }) => {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const selectedActionType = config.actionType || 'SEND_EMAIL';
    const isUnsupportedAction = !SUPPORTED_ACTION_IDS.has(selectedActionType);
    const smsMetrics = getSmsMetrics(String(config.smsMessage || ''));
    const [smsCostPerSegment, setSmsCostPerSegment] = useState(0);

    useEffect(() => {
        const fetchSmsSettings = async () => {
            if (!token || !currentAccount?.id) return;

            try {
                const settings = await api.get<{ smsCostPerSegment?: number }>('/api/sms/settings', token, currentAccount.id);
                setSmsCostPerSegment(Number(settings?.smsCostPerSegment ?? 0));
            } catch {
                setSmsCostPerSegment(0);
            }
        };

        void fetchSmsSettings();
    }, [token, currentAccount?.id]);

    const estimatedCost = smsMetrics.segments * smsCostPerSegment;

    return (
        <>
            {!config.actionType && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Action Type</label>
                    <select
                        value={selectedActionType}
                        onChange={(e) => onUpdate('actionType', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                        {ACTION_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                    </select>
                </div>
            )}

            {selectedActionType === 'SEND_EMAIL' && (
                <SendEmailConfig config={config} onUpdate={onUpdate} onUpdateMany={onUpdateMany} />
            )}

            {isUnsupportedAction && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <h4 className="text-sm font-semibold text-amber-900">Action coming soon</h4>
                    <p className="mt-1 text-sm text-amber-800">
                        This action can stay in existing flows, but it is not currently configurable or executable. Choose a supported action before activating this path.
                    </p>
                </div>
            )}

            {selectedActionType === 'SEND_SMS' && (
                <>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">SMS Message</label>
                        <textarea
                            value={config.smsMessage || ''}
                            onChange={(e) => onUpdate('smsMessage', sanitizeBidiText(e.target.value))}
                            placeholder="Hi {{customer.firstName}}, thanks for your order!"
                            rows={3}
                            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${smsMetrics.overLimit ? 'border-red-300' : 'border-gray-300'}`}
                            dir="ltr"
                            style={LTR_TEXT_STYLE}
                        />
                        <div className="mt-1 flex items-center justify-between gap-3 text-xs text-gray-500">
                            <p>Use {"{{variable}}"} for personalization</p>
                            <p>
                                {smsMetrics.segments} SMS {smsMetrics.segments === 1 ? 'message' : 'messages'}
                                {' '}
                                ({smsMetrics.rawLength}/{smsMetrics.maxLength} chars)
                            </p>
                        </div>
                        {smsMetrics.rawLength > 0 && (
                            <p className={`mt-1 text-xs ${smsMetrics.overLimit ? 'text-red-600' : smsMetrics.segments > 1 ? 'text-amber-700' : 'text-gray-500'}`}>
                                {smsMetrics.overLimit
                                    ? `Message exceeds Twilio limit by ${smsMetrics.rawLength - smsMetrics.maxLength} characters and cannot be sent.`
                                    : smsMetrics.segments > 1
                                        ? `This message will be split into ${smsMetrics.segments} SMS segments (${smsMetrics.isGsm ? 'GSM-7' : 'Unicode'} encoding).`
                                        : `Uses ${smsMetrics.isGsm ? 'GSM-7' : 'Unicode'} encoding.`}
                            </p>
                        )}
                        {smsMetrics.segments > 0 && smsCostPerSegment > 0 && (
                            <p className="mt-1 text-xs text-gray-600">
                                Est. cost: {smsMetrics.segments} x ${smsCostPerSegment.toFixed(4)} = ${estimatedCost.toFixed(4)}
                            </p>
                        )}
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

            {selectedActionType === 'ADD_TAG' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tag Name</label>
                    <input
                        type="text"
                        value={config.tagName || ''}
                        onChange={(e) => onUpdate('tagName', sanitizeBidiText(e.target.value))}
                        placeholder="VIP Customer"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        dir="ltr"
                        style={LTR_TEXT_STYLE}
                    />
                    <p className="text-xs text-gray-500 mt-1">This tag will be added to the contact</p>
                </div>
            )}

            {selectedActionType === 'REMOVE_TAG' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tag Name</label>
                    <input
                        type="text"
                        value={config.tagName || ''}
                        onChange={(e) => onUpdate('tagName', sanitizeBidiText(e.target.value))}
                        placeholder="Abandoned Cart"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        dir="ltr"
                        style={LTR_TEXT_STYLE}
                    />
                    <p className="text-xs text-gray-500 mt-1">This tag will be removed from the contact</p>
                </div>
            )}

            {selectedActionType === 'WEBHOOK' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
                    <input
                        type="url"
                        value={config.webhookUrl || ''}
                        onChange={(e) => onUpdate('webhookUrl', sanitizeBidiText(e.target.value))}
                        placeholder="https://example.com/webhook"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        dir="ltr"
                        style={LTR_TEXT_STYLE}
                    />
                </div>
            )}

            {selectedActionType === 'GENERATE_COUPON' && (
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
                                onChange={(e) => onUpdate('codePrefix', sanitizeBidiText(e.target.value))}
                                placeholder="WINBACK"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                dir="ltr"
                                style={LTR_TEXT_STYLE}
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
                            onChange={(e) => onUpdate('description', sanitizeBidiText(e.target.value))}
                            placeholder="Special recovery offer"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            dir="ltr"
                            style={LTR_TEXT_STYLE}
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

            {selectedActionType === 'ADD_ORDER_NOTE' && (
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Order Note</label>
                        <textarea
                            value={config.noteContent || ''}
                            onChange={(e) => onUpdate('noteContent', sanitizeBidiText(e.target.value))}
                            placeholder="Order updated by automation for {{customer.email}}"
                            rows={4}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            dir="ltr"
                            style={LTR_TEXT_STYLE}
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

            {selectedActionType === 'UPDATE_ORDER_STATUS' && (
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
