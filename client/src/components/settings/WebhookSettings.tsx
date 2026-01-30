import { useState, useEffect } from 'react';
import { Copy, Check, Webhook, ExternalLink, Save, Loader2, Info } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';

interface WebhookConfig {
    name: string;
    topic: string;
    description: string;
}

const WEBHOOK_TOPICS: WebhookConfig[] = [
    {
        name: 'Order Created',
        topic: 'order.created',
        description: 'Fires when a new order is placed. Enables instant order notifications.'
    },
    {
        name: 'Order Updated',
        topic: 'order.updated',
        description: 'Fires when an order status changes. Keeps order data in sync.'
    },
    {
        name: 'Product Created',
        topic: 'product.created',
        description: 'Fires when a new product is added to the catalog.'
    },
    {
        name: 'Product Updated',
        topic: 'product.updated',
        description: 'Fires when product details are modified.'
    },
    {
        name: 'Customer Created',
        topic: 'customer.created',
        description: 'Fires when a new customer registers.'
    },
    {
        name: 'Customer Updated',
        topic: 'customer.updated',
        description: 'Fires when customer details are modified.'
    }
];

/**
 * WebhookSettings component provides copy-paste ready webhook configuration
 * for WooCommerce integration, with editable webhook secret.
 */
export function WebhookSettings() {
    const { currentAccount, refreshAccounts } = useAccount();
    const { token } = useAuth();
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Get current webhook secret from account
    const rawData = currentAccount as unknown as { webhookSecret?: string; wooConsumerSecret?: string };
    const [secretInput, setSecretInput] = useState(rawData?.webhookSecret || '');

    // Update local state when account changes
    useEffect(() => {
        const data = currentAccount as unknown as { webhookSecret?: string };
        setSecretInput(data?.webhookSecret || '');
    }, [currentAccount]);

    // Get the base API URL - prefer browser origin for correct public URL display
    const apiUrl = window.location.origin;

    // Construct the webhook URL
    const webhookUrl = `${apiUrl}/api/webhooks/${currentAccount?.id || '{accountId}'}`;

    const handleCopy = (text: string, field: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    };

    const handleSaveSecret = async () => {
        if (!currentAccount || !token) return;

        setIsSaving(true);
        setSaveMessage(null);

        try {
            const response = await fetch(`/api/accounts/${currentAccount.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ webhookSecret: secretInput })
            });

            if (response.ok) {
                setSaveMessage({ type: 'success', text: 'Webhook secret saved!' });
                refreshAccounts?.();
            } else {
                setSaveMessage({ type: 'error', text: 'Failed to save' });
            }
        } catch {
            setSaveMessage({ type: 'error', text: 'Network error' });
        } finally {
            setIsSaving(false);
            setTimeout(() => setSaveMessage(null), 3000);
        }
    };

    const CopyButton = ({ text, field }: { text: string; field: string }) => (
        <button
            onClick={() => handleCopy(text, field)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shadow-xs ${copiedField === field
                ? 'bg-green-100 text-green-700 border border-green-200'
                : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
                }`}
        >
            {copiedField === field ? <Check size={14} /> : <Copy size={14} />}
            {copiedField === field ? 'Copied!' : 'Copy'}
        </button>
    );

    return (
        <div className="space-y-6">
            {/* Info Banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
                <Info className="shrink-0 w-5 h-5 text-blue-600 mt-0.5" />
                <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">Instant Order Sync with Webhooks</p>
                    <p>
                        Configure these webhooks in WooCommerce for instant order updates instead of waiting for the 5-minute sync.
                        Go to <strong>WooCommerce → Settings → Advanced → Webhooks</strong>.
                    </p>
                </div>
            </div>

            {/* Webhook URL */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700">Delivery URL</label>
                    <CopyButton text={webhookUrl} field="url" />
                </div>
                <div className="relative">
                    <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg overflow-x-auto font-mono text-sm border border-slate-800">
                        <code>{webhookUrl}</code>
                    </pre>
                </div>
                <p className="text-xs text-gray-500">Use this URL for all webhook configurations in WooCommerce.</p>
            </div>

            {/* Webhook Secret - Editable */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700">Secret Key</label>
                    <div className="flex items-center gap-2">
                        {saveMessage && (
                            <span className={`text-xs ${saveMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                                {saveMessage.text}
                            </span>
                        )}
                        {secretInput && <CopyButton text={secretInput} field="secret" />}
                    </div>
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={secretInput}
                        onChange={(e) => setSecretInput(e.target.value)}
                        placeholder="Paste your WooCommerce webhook secret here"
                        className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <button
                        onClick={handleSaveSecret}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
                    >
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        Save
                    </button>
                </div>
                <p className="text-xs text-gray-500">
                    Copy the secret from your WooCommerce webhook configuration and paste it here. This validates webhook signatures.
                </p>
            </div>

            {/* Webhook Topics */}
            <div className="border-t border-gray-100 pt-6">
                <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Webhook size={16} className="text-gray-500" />
                    Recommended Webhooks
                </h3>
                <p className="text-xs text-gray-500 mb-4">
                    Create the following webhooks in WooCommerce. At minimum, configure <strong>Order Created</strong> for instant notifications.
                </p>

                <div className="grid gap-3">
                    {WEBHOOK_TOPICS.map((webhook) => (
                        <div
                            key={webhook.topic}
                            className="bg-gray-50 rounded-lg p-4 border border-gray-200 flex items-center justify-between gap-4"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${webhook.topic.includes('order') ? 'bg-green-500' : 'bg-blue-500'
                                        }`} />
                                    <p className="text-sm font-medium text-gray-900">{webhook.name}</p>
                                    <span className="text-xs font-mono text-gray-500 bg-gray-200 px-2 py-0.5 rounded-sm">
                                        {webhook.topic}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-500 mt-1 truncate">{webhook.description}</p>
                            </div>
                            <CopyButton text={webhook.topic} field={webhook.topic} />
                        </div>
                    ))}
                </div>
            </div>

            {/* Setup Steps */}
            <div className="border-t border-gray-100 pt-6">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Quick Setup Guide</h3>
                <ol className="space-y-3 text-sm text-gray-700">
                    <li className="flex gap-3">
                        <span className="shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-medium">1</span>
                        <span>Go to <strong>WooCommerce → Settings → Advanced → Webhooks</strong></span>
                    </li>
                    <li className="flex gap-3">
                        <span className="shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-medium">2</span>
                        <span>Click <strong>Add Webhook</strong></span>
                    </li>
                    <li className="flex gap-3">
                        <span className="shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-medium">3</span>
                        <span>Set <strong>Status</strong> to Active</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-medium">4</span>
                        <span>Select the <strong>Topic</strong> (e.g., Order created)</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-medium">5</span>
                        <span>Paste the <strong>Delivery URL</strong> from above</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-medium">6</span>
                        <span>Paste the <strong>Secret</strong> and click <strong>Save webhook</strong></span>
                    </li>
                </ol>
            </div>

            {/* External Link */}
            <div className="pt-2">
                <a
                    href="https://woocommerce.com/document/webhooks/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 hover:underline"
                >
                    <ExternalLink size={14} />
                    WooCommerce Webhooks Documentation
                </a>
            </div>
        </div>
    );
}
