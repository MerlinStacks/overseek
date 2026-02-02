/**
 * ActionConfig - Configuration panel for flow action nodes.
 * Extracted from NodeConfigPanel for modularity.
 */
import React from 'react';
import { SendEmailConfig } from '../SendEmailConfig';

export interface ActionConfigProps {
    config: any;
    onUpdate: (key: string, value: any) => void;
}

const ACTION_TYPES = [
    { value: 'SEND_EMAIL', label: 'Send Email' },
    { value: 'SEND_SMS', label: 'Send SMS' },
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
        </>
    );
};
