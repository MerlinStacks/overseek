import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useToast } from '../context/ToastContext';
import { Logger } from '../utils/logger';
import { RichTextEditor } from '../components/common/RichTextEditor';

interface EmailSettings {
    bounceTrackingEnabled: boolean;
    maxSendPerSecond: number;
    maxSendPerDay: number;
}

const DEFAULT_SETTINGS: EmailSettings = {
    bounceTrackingEnabled: false,
    maxSendPerSecond: 1,
    maxSendPerDay: 6000,
};

const buildDefaultEmailFooterHtml = (accountName: string) => `<p>You are receiving this email from ${accountName}.<br /><a href="{{unsubscribe_url}}">Unsubscribe</a></p>`;
const EMAIL_FOOTER_MERGE_TAGS = [
    { label: 'Store URL', value: '{{store_url}}' },
    { label: 'Unsubscribe URL', value: '{{unsubscribe_url}}' },
    { label: 'Email Preferences URL', value: '{{preferences_url}}' },
    { label: 'Customer First Name', value: '{{customer.firstName}}' },
    { label: 'Customer Last Name', value: '{{customer.lastName}}' },
    { label: 'Customer Email', value: '{{customer.email}}' },
    { label: 'Order Number', value: '{{order.number}}' },
    { label: 'Order Total', value: '{{order.total}}' },
];

export function EmailSettingsPage() {
    const { token } = useAuth();
    const { currentAccount, refreshAccounts } = useAccount();
    const toast = useToast();

    const [settings, setSettings] = useState<EmailSettings>(DEFAULT_SETTINGS);
    const [emailFooterHtml, setEmailFooterHtml] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingFooter, setIsSavingFooter] = useState(false);
    const [suppressions, setSuppressions] = useState<Array<{ id: string; email: string; scope: 'MARKETING' | 'ALL'; reason: string | null; createdAt: string }>>([]);
    const [isLoadingSuppressions, setIsLoadingSuppressions] = useState(false);
    const [suppressionQuery, setSuppressionQuery] = useState('');
    const [suppressionPage, setSuppressionPage] = useState(1);
    const [suppressionTotalPages, setSuppressionTotalPages] = useState(1);

    const fetchSuppressions = useCallback(async (page = 1, query = '') => {
        if (!currentAccount || !token) return;
        setIsLoadingSuppressions(true);
        try {
            const params = new URLSearchParams();
            params.set('page', String(page));
            params.set('limit', '10');
            if (query.trim()) params.set('q', query.trim());

            const response = await fetch(`/api/email/suppressions?${params.toString()}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                },
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(payload?.error || 'Failed to load suppressed contacts');
            }

            const data = await response.json() as {
                suppressions: Array<{ id: string; email: string; scope: 'MARKETING' | 'ALL'; reason: string | null; createdAt: string }>;
                page: number;
                totalPages: number;
            };

            setSuppressions(data.suppressions || []);
            setSuppressionPage(data.page || 1);
            setSuppressionTotalPages(data.totalPages || 1);
        } catch (error) {
            Logger.error('Failed to load suppressions', { error });
            const message = error instanceof Error ? error.message : 'Failed to load suppressed contacts.';
            toast.error(message);
        } finally {
            setIsLoadingSuppressions(false);
        }
    }, [currentAccount, token, toast]);

    useEffect(() => {
        async function loadSettings() {
            if (!currentAccount || !token) return;

            setIsLoading(true);
            try {
                const response = await fetch('/api/email/settings', {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'x-account-id': currentAccount.id,
                    },
                });

                if (!response.ok) {
                    const payload = await response.json().catch(() => null) as { error?: string } | null;
                    throw new Error(payload?.error || 'Failed to load email settings');
                }

                const data = await response.json() as EmailSettings;
                setSettings({
                    bounceTrackingEnabled: Boolean(data.bounceTrackingEnabled),
                    maxSendPerSecond: Number(data.maxSendPerSecond) || 1,
                    maxSendPerDay: Number(data.maxSendPerDay) || 6000,
                });
            } catch (error) {
                Logger.error('Failed to load email settings', { error });
                const message = error instanceof Error ? error.message : 'Failed to load email settings.';
                toast.error(message);
            } finally {
                setIsLoading(false);
            }
        }

        loadSettings();
    }, [currentAccount, token, toast]);

    useEffect(() => {
        if (currentAccount && token) {
            fetchSuppressions(1, '');
        }
    }, [currentAccount, token, fetchSuppressions]);

    useEffect(() => {
        if (!currentAccount) return;
        setEmailFooterHtml(currentAccount.appearance?.emailFooterHtml || buildDefaultEmailFooterHtml(currentAccount.appearance?.appName || currentAccount.name || 'Your Store'));
    }, [currentAccount]);

    const handleSave = async () => {
        if (!currentAccount || !token) return;

        setIsSaving(true);
        try {
            const response = await fetch('/api/email/settings', {
                method: 'POST',
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

            toast.success('Email settings saved.');
        } catch (error) {
            Logger.error('Failed to save email settings', { error });
            const message = error instanceof Error ? error.message : 'Failed to save email settings.';
            toast.error(message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveFooter = async () => {
        if (!currentAccount || !token) return;

        setIsSavingFooter(true);
        try {
            const appearance = {
                ...(currentAccount.appearance || {}),
                emailFooterHtml: emailFooterHtml || buildDefaultEmailFooterHtml(currentAccount.appearance?.appName || currentAccount.name || 'Your Store'),
            };
            const response = await fetch(`/api/accounts/${currentAccount.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ appearance }),
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(payload?.error || 'Failed to save account email footer');
            }

            await refreshAccounts();
            toast.success('Account email footer saved.');
        } catch (error) {
            Logger.error('Failed to save account email footer', { error });
            const message = error instanceof Error ? error.message : 'Failed to save account email footer.';
            toast.error(message);
        } finally {
            setIsSavingFooter(false);
        }
    };

    const handleRemoveSuppression = async (email: string) => {
        if (!currentAccount || !token) return;
        if (!confirm(`Remove suppression for ${email}?`)) return;

        try {
            const response = await fetch(`/api/email/suppressions/${encodeURIComponent(email)}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                },
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(payload?.error || 'Failed to remove suppression');
            }

            toast.success('Suppression removed. This contact can receive marketing emails again.');
            await fetchSuppressions(suppressionPage, suppressionQuery);
        } catch (error) {
            Logger.error('Failed to remove suppression', { error });
            const message = error instanceof Error ? error.message : 'Failed to remove suppression.';
            toast.error(message);
        }
    };

    if (isLoading) {
        return <div>Loading...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Email Settings</h1>
                <p className="text-gray-500">Control email deliverability and sending limits for this account.</p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs max-w-3xl">
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
                                Set the maximum emails allowed per 24 hours. Once this limit is reached, sending pauses until quota resets.
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
            </div>

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
                    features={['bold', 'italic', 'underline', 'link', 'list', 'align', 'mergeTag']}
                    mergeTags={EMAIL_FOOTER_MERGE_TAGS}
                />
                <div className="flex justify-end">
                    <button
                        onClick={handleSaveFooter}
                        disabled={isSavingFooter}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                    >
                        {isSavingFooter ? 'Saving...' : 'Save Footer'}
                    </button>
                </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs max-w-3xl space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Suppressed Contacts</h2>
                        <p className="mt-1 text-sm text-gray-500">Contacts blocked from marketing sends. Remove to allow sending again.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            value={suppressionQuery}
                            onChange={(event) => setSuppressionQuery(event.target.value)}
                            placeholder="Search email"
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <button
                            onClick={() => fetchSuppressions(1, suppressionQuery)}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                        >
                            Search
                        </button>
                    </div>
                </div>

                {isLoadingSuppressions ? (
                    <div className="text-sm text-gray-500">Loading suppressed contacts...</div>
                ) : suppressions.length === 0 ? (
                    <div className="text-sm text-gray-500">No suppressed contacts found.</div>
                ) : (
                    <div className="space-y-2">
                        {suppressions.map((entry) => (
                            <div key={entry.id} className="flex items-center justify-between border border-gray-200 rounded-lg p-3 gap-3">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-gray-900 break-all">{entry.email}</div>
                                    <div className="text-xs text-gray-500">
                                        Scope: {entry.scope} {entry.reason ? `| ${entry.reason}` : ''}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleRemoveSuppression(entry.email)}
                                    className="px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50 text-sm"
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {suppressionTotalPages > 1 && (
                    <div className="flex items-center justify-end gap-2">
                        <button
                            onClick={() => fetchSuppressions(Math.max(1, suppressionPage - 1), suppressionQuery)}
                            disabled={suppressionPage <= 1 || isLoadingSuppressions}
                            className="px-3 py-1.5 rounded-md border border-gray-300 text-sm disabled:opacity-50"
                        >
                            Prev
                        </button>
                        <span className="text-sm text-gray-600">Page {suppressionPage} of {suppressionTotalPages}</span>
                        <button
                            onClick={() => fetchSuppressions(Math.min(suppressionTotalPages, suppressionPage + 1), suppressionQuery)}
                            disabled={suppressionPage >= suppressionTotalPages || isLoadingSuppressions}
                            className="px-3 py-1.5 rounded-md border border-gray-300 text-sm disabled:opacity-50"
                        >
                            Next
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
