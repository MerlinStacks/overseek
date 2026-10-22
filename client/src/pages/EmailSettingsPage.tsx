import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useToast } from '../context/ToastContext';
import { Logger } from '../utils/logger';
import { RichTextEditor } from '../components/common/RichTextEditor';
import { usePermissions } from '../hooks/usePermissions';
import { useRecoveryAttempt } from '../hooks/useRecoveryAttempt';
import { isRecord } from '../utils/responseValidation';

interface EmailSettings {
    version: string;
    bounceTrackingEnabled: boolean;
    maxSendPerSecond: number;
    maxSendPerDay: number;
}

interface EmailListSetting {
    id: string;
    name: string;
    description?: string | null;
    isDefault: boolean;
}

const DEFAULT_SETTINGS: EmailSettings = {
    version: 'default',
    bounceTrackingEnabled: false,
    maxSendPerSecond: 1,
    maxSendPerDay: 6000,
};

const buildDefaultEmailFooterHtml = (accountName: string) => `<p>You are receiving this email from ${accountName.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!)}.<br /><a href="{{unsubscribe_url}}">Unsubscribe</a></p>`;
const EMAIL_FOOTER_MERGE_TAGS = [
    { label: 'Store URL', value: '{{store_url}}' },
    { label: 'Unsubscribe URL', value: '{{unsubscribe_url}}' },
    { label: 'Unsubscribe From This List URL', value: '{{unsubscribe_list_url}}' },
    { label: 'Email Preferences URL', value: '{{preferences_url}}' },
    { label: 'Customer First Name', value: '{{customer.firstName}}' },
    { label: 'Customer Last Name', value: '{{customer.lastName}}' },
    { label: 'Customer Email', value: '{{customer.email}}' },
    { label: 'Order Number', value: '{{order.number}}' },
    { label: 'Order Total', value: '{{order.total}}' },
];

export function EmailSettingsPage() {
    const { token, user } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    if (!token || !currentAccount) return <p role="status">Sign in and select an account.</p>;
    if (!hasPermission('view_email_settings')) return <p role="status">Email settings view permission required.</p>;
    return <ScopedEmailSettings key={JSON.stringify([user?.id, token, currentAccount.id])} />;
}
function decodeSettings(data: unknown): EmailSettings {
    if (!isRecord(data) || typeof data.bounceTrackingEnabled !== 'boolean' || typeof data.maxSendPerSecond !== 'number' || !Number.isInteger(data.maxSendPerSecond) || data.maxSendPerSecond < 1 || data.maxSendPerSecond > 1000 || typeof data.maxSendPerDay !== 'number' || !Number.isInteger(data.maxSendPerDay) || data.maxSendPerDay < 1 || data.maxSendPerDay > 1000000 || typeof data.version !== 'string' || data.version !== 'default' && !Number.isFinite(Date.parse(data.version))) throw new Error('Invalid settings response');
    return data as unknown as EmailSettings;
}
function ScopedEmailSettings() {
    const { token } = useAuth();
    const { currentAccount, refreshAccounts } = useAccount();
    const toast = useToast();
    const { hasPermission } = usePermissions();
    const attempt = useRecoveryAttempt();
    const [error, setError] = useState('');

    const [settings, setSettings] = useState<EmailSettings>(DEFAULT_SETTINGS);
    const [emailFooterHtml, setEmailFooterHtml] = useState(() => currentAccount?.appearance?.emailFooterHtml || buildDefaultEmailFooterHtml(currentAccount?.appearance?.appName || currentAccount?.name || 'Your Store'));
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingMarketing, setIsSavingMarketing] = useState(false);
    const [isSavingFooter, setIsSavingFooter] = useState(false);
    const [subscribeNewCustomersByDefault, setSubscribeNewCustomersByDefault] = useState(true);
    const [emailLists, setEmailLists] = useState<EmailListSetting[]>([]);

    useEffect(() => {
        const controller = new AbortController(); let disposed = false;
        const timer = setTimeout(() => controller.abort(), 30000);
        async function loadSettings() {
            if (!currentAccount || !token) return;

            setIsLoading(true);
            try {
                const headers = {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                };
                const [response, listsResponse] = await Promise.all([
                    fetch('/api/email/settings', { headers, signal: controller.signal }),
                    fetch('/api/email/lists', { headers, signal: controller.signal }),
                ]);

                if (!response.ok) {
                    const payload = await response.json().catch(() => null) as { error?: string } | null;
                    throw new Error(payload?.error || 'Failed to load email settings');
                }

                const data = decodeSettings(await response.json());
                if (disposed) return;
                setSettings(data);
                if (!listsResponse.ok) throw new Error('Failed to load email lists');
                const lists = await listsResponse.json() as EmailListSetting[];
                if (disposed) return;
                if (!Array.isArray(lists) || lists.length > 1000 || lists.some(list => typeof list.id !== 'string' || typeof list.name !== 'string' || typeof list.isDefault !== 'boolean')) throw new Error('Invalid email lists');
                setEmailLists(lists);
                setSubscribeNewCustomersByDefault(currentAccount.subscribeNewCustomersByDefault ?? true);
            } catch (error) {
                if (disposed) return;
                setError('Settings unavailable. Reload before editing.');
                Logger.error('Failed to load email settings', { error });
                const message = error instanceof Error ? error.message : 'Failed to load email settings.';
                toast.error(message);
            } finally {
                clearTimeout(timer);
                if (!disposed) setIsLoading(false);
            }
        }

        loadSettings();
        return () => { disposed = true; clearTimeout(timer); controller.abort(); };
    }, [currentAccount, token, toast]);

    const handleSave = async () => {
        if (!currentAccount || !token || error || !hasPermission('manage_email_settings')) return;
        const active = attempt.begin(); if (!active) return;
        const timer = setTimeout(() => active.abort(), 30000);

        setIsSaving(true);
        try {
            const response = await fetch('/api/email/settings', {
                method: 'POST',
                signal: active.signal,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                },
                body: JSON.stringify(settings),
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(payload?.error || 'Failed to save email settings');
            }

            const result = await response.json();
            if (!isRecord(result) || result.success !== true) throw new Error('Invalid acknowledgement');
            const saved = decodeSettings(result.settings);
            if (!attempt.current(active)) return;
            setSettings(saved); toast.success('Email settings saved.');
        } catch (error) {
            if (!attempt.current(active, true)) return;
            setError('Save not acknowledged or version changed. Reload to reconcile before further writes.');
            Logger.error('Failed to save email settings', { error });
            const message = error instanceof Error ? error.message : 'Failed to save email settings.';
            toast.error(message);
        } finally {
            clearTimeout(timer); attempt.finish(); if (attempt.current(active, true)) setIsSaving(false);
        }
    };

    const handleSaveMarketingDefaults = async () => {
        if (!currentAccount || !token || error || !hasPermission('manage_marketing')) return;
        const active = attempt.begin(); if (!active) return;
        const timer = setTimeout(() => active.abort(), 30000);

        setIsSavingMarketing(true);
        try {
            const accountResponse = await fetch(`/api/accounts/${currentAccount.id}`, {
                method: 'PUT',
                signal: active.signal,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                },
                body: JSON.stringify({ subscribeNewCustomersByDefault }),
            });
            if (!accountResponse.ok) throw new Error('Failed to save new customer marketing setting');
            if (!attempt.current(active)) return;

            const listResponses = await Promise.all(emailLists.map((list) => fetch(`/api/email/lists/${list.id}`, {
                method: 'PUT',
                signal: active.signal,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                },
                body: JSON.stringify({ isDefault: list.isDefault }),
            })));
            if (listResponses.some((listResponse) => !listResponse.ok)) {
                throw new Error('Failed to save one or more default email lists');
            }

            if (!attempt.current(active)) return;
            await refreshAccounts();
            if (attempt.current(active)) toast.success('Marketing defaults saved.');
        } catch (error) {
            if (!attempt.current(active, true)) return;
            setError('Marketing defaults may be partially saved. Reload and reconcile before further writes.');
            Logger.error('Failed to save marketing defaults', { error });
            const message = error instanceof Error ? error.message : 'Failed to save marketing defaults.';
            toast.error(message);
        } finally {
            clearTimeout(timer); attempt.finish(); if (attempt.current(active, true)) setIsSavingMarketing(false);
        }
    };

    const handleSaveFooter = async () => {
        if (!currentAccount || !token || error || !hasPermission('manage_email_settings')) return;
        const active = attempt.begin(); if (!active) return;
        const timer = setTimeout(() => active.abort(), 30000);

        setIsSavingFooter(true);
        try {
            const appearance = {
                ...(currentAccount.appearance || {}),
                emailFooterHtml: emailFooterHtml || buildDefaultEmailFooterHtml(currentAccount.appearance?.appName || currentAccount.name || 'Your Store'),
            };
            const response = await fetch(`/api/accounts/${currentAccount.id}`, {
                method: 'PUT',
                signal: active.signal,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                },
                body: JSON.stringify({ appearance }),
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(payload?.error || 'Failed to save account email footer');
            }

            if (!attempt.current(active)) return;
            await refreshAccounts();
            if (attempt.current(active)) toast.success('Account email footer saved.');
        } catch (error) {
            if (!attempt.current(active, true)) return;
            setError('Footer save not acknowledged. Reload and reconcile before further writes.');
            Logger.error('Failed to save account email footer', { error });
            const message = error instanceof Error ? error.message : 'Failed to save account email footer.';
            toast.error(message);
        } finally {
            clearTimeout(timer); attempt.finish(); if (attempt.current(active, true)) setIsSavingFooter(false);
        }
    };

    if (isLoading) {
        return <div>Loading...</div>;
    }
    if (error) return <p role="alert">{error} Local changes have not been confirmed. <button type="button" onClick={() => window.location.reload()}>Reload settings</button></p>;

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Email Settings</h1>
                <p className="text-gray-500">Control email deliverability and sending limits for this account.</p>
            </div>

            <div className="max-w-3xl space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
                <div>
                    <h2 className="text-base font-semibold text-gray-900">New Customer Marketing</h2>
                    <p className="mt-1 text-sm text-gray-500">Control how newly created WooCommerce customers are enrolled in marketing.</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-start">
                    <span className="pt-1 text-sm font-medium text-gray-700">Subscribe by default</span>
                    <label className="inline-flex items-start gap-3">
                        <input
                            type="checkbox"
                            checked={subscribeNewCustomersByDefault}
                            onChange={(event) => setSubscribeNewCustomersByDefault(event.target.checked)}
                            className="mt-1 size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-600">
                            Allow new customers to receive marketing emails automatically. When disabled, marketing flow emails are blocked until the customer explicitly subscribes.
                        </span>
                    </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-start">
                    <span className="pt-1 text-sm font-medium text-gray-700">Default lists</span>
                    <div className="space-y-2">
                        {emailLists.map((list) => (
                            <label key={list.id} className="flex items-start gap-3 rounded-lg border border-gray-200 p-3">
                                <input
                                    type="checkbox"
                                    checked={list.isDefault}
                                    onChange={(event) => setEmailLists((current) => current.map((item) => item.id === list.id
                                        ? { ...item, isDefault: event.target.checked }
                                        : item))}
                                    className="mt-0.5 size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span>
                                    <span className="block text-sm font-medium text-gray-800">{list.name}</span>
                                    {list.description && <span className="mt-0.5 block text-xs text-gray-500">{list.description}</span>}
                                </span>
                            </label>
                        ))}
                        {emailLists.length === 0 && <p className="text-sm text-gray-500">Create an email list before selecting default lists.</p>}
                    </div>
                </div>

                <div className="pt-1">
                    <button
                        onClick={handleSaveMarketingDefaults}
                        disabled={isSavingMarketing || !hasPermission('manage_marketing')}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                    >
                        {isSavingMarketing ? 'Saving...' : 'Save Marketing Defaults'}
                    </button>
                </div>
            </div>

            <fieldset disabled={isSaving || !hasPermission('manage_email_settings')} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white p-6 shadow-xs max-w-3xl">
                <h2 className="text-base font-semibold text-gray-900 mb-6">Email Service Provider</h2>

                <div className="space-y-6">
                    <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-start">
                        <label className="text-sm font-medium text-gray-700 pt-1">Bounce Tracking</label>
                        <label className="inline-flex items-start gap-3">
                            <input
                                type="checkbox"
                                checked={settings.bounceTrackingEnabled}
                                onChange={(e) => setSettings((prev) => ({ ...prev, bounceTrackingEnabled: e.target.checked }))}
                                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-600">
                                Enable to capture bounced emails from the email service and mark contacts as bounced.
                            </span>
                        </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-start">
                        <label htmlFor="maxSendPerSecond" className="text-sm font-medium text-gray-700 pt-2">Max Sending Limit</label>
                        <div>
                            <div className="flex max-w-sm rounded-lg border border-gray-300 overflow-hidden">
                                <input
                                    id="maxSendPerSecond"
                                    type="number"
                                    min={1}
                                    max={1000}
                                    value={settings.maxSendPerSecond}
                                    onChange={(e) => setSettings((prev) => ({ ...prev, maxSendPerSecond: Math.max(1, Number(e.target.value) || 1) }))}
                                    className="w-full px-3 py-2 text-sm text-gray-900 focus:outline-none"
                                />
                                <span className="bg-gray-50 border-l border-gray-300 px-3 py-2 text-sm text-gray-600">Per Sec</span>
                            </div>
                            <p className="mt-2 text-sm text-gray-500">
                                Enter the maximum email sending rate. This value helps throttle outbound sends from automations.
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-start">
                        <label htmlFor="maxSendPerDay" className="text-sm font-medium text-gray-700 pt-2">Daily Sending Limit</label>
                        <div>
                            <div className="flex max-w-sm rounded-lg border border-gray-300 overflow-hidden">
                                <input
                                    id="maxSendPerDay"
                                    type="number"
                                    min={1}
                                    max={1000000}
                                    value={settings.maxSendPerDay}
                                    onChange={(e) => setSettings((prev) => ({ ...prev, maxSendPerDay: Math.max(1, Number(e.target.value) || 1) }))}
                                    className="w-full px-3 py-2 text-sm text-gray-900 focus:outline-none"
                                />
                                <span className="bg-gray-50 border-l border-gray-300 px-3 py-2 text-sm text-gray-600">Per Day</span>
                            </div>
                            <p className="mt-2 text-sm text-gray-500">
                                Marketing send attempts per UTC calendar day. Sending pauses until the next UTC day when this limit is reached.
                            </p>
                        </div>
                    </div>

                    <div className="pt-2">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                        >
                            {isSaving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            </fieldset>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs max-w-3xl space-y-4">
                <div>
                    <h2 className="text-base font-semibold text-gray-900">Account Email Footer</h2>
                    <p className="mt-1 text-sm text-gray-500">Used by Email Designer v2 footer blocks for this account. Include <code>{'{{unsubscribe_url}}'}</code> in your footer content.</p>
                </div>
                <RichTextEditor
                    value={emailFooterHtml}
                    onChange={setEmailFooterHtml}
                    placeholder="<p>You are receiving this email from Your Store...</p>"
                    variant="standard"
                    features={['bold', 'italic', 'underline', 'link', 'list', 'align', 'mergeTag', 'image', 'social']}
                    mergeTags={EMAIL_FOOTER_MERGE_TAGS}
                />
                <div className="flex justify-end">
                    <button
                        onClick={handleSaveFooter}
                        disabled={isSavingFooter || !hasPermission('manage_email_settings')}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                    >
                        {isSavingFooter ? 'Saving...' : 'Save Footer'}
                    </button>
                </div>
            </div>

        </div>
    );
}
