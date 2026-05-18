import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { EmailAccountForm, type EmailAccount } from './EmailAccountForm';
import { EmailAccountList } from './EmailAccountList';
import { RefreshCw } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { RichTextEditor } from '../common/RichTextEditor';

const buildDefaultEmailFooterHtml = (accountName: string) => `<p>You are receiving this email from ${accountName}.<br /><a href="{{unsubscribe_url}}">Unsubscribe</a></p>`;

/**
 * Email Settings page - manages unified email accounts with SMTP/IMAP.
 */
export function EmailSettings() {
    const { token } = useAuth();
    const { currentAccount, refreshAccounts } = useAccount();
    const toast = useToast();
    const [accounts, setAccounts] = useState<EmailAccount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [accountsLoadError, setAccountsLoadError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);
    const [syncResult, setSyncResult] = useState<{ success: boolean; message?: string; checked?: number } | null>(null);
    const [emailFooterHtml, setEmailFooterHtml] = useState('');
    const [isSavingFooter, setIsSavingFooter] = useState(false);

    const [editingAccount, setEditingAccount] = useState<Partial<EmailAccount> | null>(null);

    const fetchAccounts = useCallback(async () => {
        if (!currentAccount || !token) return;
        setAccountsLoadError(null);
        try {
            const res = await fetch('/api/email/accounts', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => null) as { error?: string } | null;
                throw new Error(payload?.error || 'Failed to load email accounts');
            }

            const data = await res.json();
            setAccounts(data);
        } catch (error) {
            Logger.error('An error occurred', { error: error });
            const message = error instanceof Error ? error.message : 'Failed to load email accounts.';
            setAccountsLoadError(message);
            toast.error(message);
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token, toast]);

    useEffect(() => {
        if (currentAccount && token) {
            fetchAccounts();
        }
    }, [currentAccount, token, fetchAccounts]);

    useEffect(() => {
        if (!currentAccount) return;
        setEmailFooterHtml(currentAccount.appearance?.emailFooterHtml || buildDefaultEmailFooterHtml(currentAccount.appearance?.appName || currentAccount.name || 'Your Store'));
    }, [currentAccount]);

    const handleSaveFooter = async () => {
        if (!currentAccount || !token) return;
        setIsSavingFooter(true);
        try {
            const appearance = {
                ...(currentAccount.appearance || {}),
                emailFooterHtml: emailFooterHtml || buildDefaultEmailFooterHtml(currentAccount.appearance?.appName || currentAccount.name || 'Your Store'),
            };
            const res = await fetch(`/api/accounts/${currentAccount.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ appearance }),
            });
            if (!res.ok) throw new Error('Failed to save email footer');
            await refreshAccounts();
            toast.success('Email footer saved.');
        } catch (error) {
            Logger.error('Failed to save email footer', { error });
            toast.error('Failed to save email footer.');
        } finally {
            setIsSavingFooter(false);
        }
    };

    const handleSave = async (accountData: Partial<EmailAccount>) => {
        if (!currentAccount || !token) return;
        setIsSaving(true);
        setTestResult(null);

        try {
            const method = accountData.id ? 'PUT' : 'POST';
            const url = accountData.id
                ? `/api/email/accounts/${accountData.id}`
                : '/api/email/accounts';

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify(accountData)
            });

            if (!res.ok) throw new Error('Failed to save account');

            await fetchAccounts();
            setEditingAccount(null);
        } catch (error) {
            Logger.error('An error occurred', { error: error });
            toast.error('Failed to save email account.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this account?')) return;
        if (!currentAccount) return;

        try {
            await fetch(`/api/email/accounts/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            setAccounts(accounts.filter(a => a.id !== id));
        } catch (error) {
            Logger.error('An error occurred', { error: error });
            toast.error('Failed to delete email account.');
        }
    };

    const handleTestConnection = async (testData: { protocol: 'SMTP' | 'IMAP'; host: string; port: number; username: string; password: string; isSecure: boolean; id?: string }) => {
        if (!currentAccount) return { success: false, message: 'No account selected' };
        setIsTesting(true);
        setTestResult(null);

        try {
            const res = await fetch('/api/email/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify(testData)
            });

            const data = await res.json();
            const result = { success: data.success, message: data.error };
            setTestResult(result);
            return result;
        } catch (error) {
            const result = { success: false, message: 'Network error' };
            setTestResult(result);
            return result;
        } finally {
            setIsTesting(false);
        }
    };

    const handleSyncNow = async () => {
        if (!currentAccount || !token) return;
        setIsSyncing(true);
        setSyncResult(null);

        try {
            const res = await fetch('/api/email/sync', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            const data = await res.json();
            setSyncResult({
                success: data.success,
                message: data.errors?.join(', ') || data.message,
                checked: data.checked
            });
        } catch (error) {
            setSyncResult({ success: false, message: 'Network error' });
        } finally {
            setIsSyncing(false);
        }
    };

    const handleSetDefault = async (id: string) => {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch(`/api/email/accounts/${id}/default`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                await fetchAccounts();
            }
        } catch (error) {
            Logger.error('An error occurred', { error: error });
        }
    };

    if (isLoading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            {!editingAccount && (
                <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-4 space-y-3">
                    <div>
                        <h3 className="font-medium text-gray-900">Account Email Footer</h3>
                        <p className="text-sm text-gray-500">Used by Email Designer v2 footer blocks for this account. Include <code>{'{{unsubscribe_url}}'}</code> in your footer content.</p>
                    </div>
                    <RichTextEditor
                        value={emailFooterHtml}
                        onChange={setEmailFooterHtml}
                        placeholder="<p>You are receiving this email from Your Store...</p>"
                        variant="standard"
                        features={['bold', 'italic', 'underline', 'link', 'list']}
                    />
                    <div className="flex justify-end">
                        <button
                            onClick={handleSaveFooter}
                            disabled={isSavingFooter}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                            {isSavingFooter ? 'Saving...' : 'Save Footer'}
                        </button>
                    </div>
                </div>
            )}

            {/* Sync Button & Status */}
            {!editingAccount && (
                <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="font-medium text-gray-900">Email Sync</h3>
                            <p className="text-sm text-gray-500">Check enabled IMAP accounts for new emails</p>
                        </div>
                        <button
                            onClick={handleSyncNow}
                            disabled={isSyncing}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
                            {isSyncing ? 'Syncing...' : 'Sync Now'}
                        </button>
                    </div>
                    {syncResult && (
                        <div className={`mt-3 p-3 rounded-lg text-sm ${syncResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {syncResult.success
                                ? `Checked ${syncResult.checked || 0} IMAP account(s). ${syncResult.message || 'Check your Inbox for new messages.'}`
                                : `Sync failed: ${syncResult.message}`
                            }
                        </div>
                    )}
                </div>
            )}

            {!editingAccount && (
                accountsLoadError ? (
                    <div className="bg-white rounded-xl shadow-xs border border-red-200 p-6">
                        <h3 className="text-base font-medium text-red-700">Couldn\'t load email accounts</h3>
                        <p className="text-sm text-red-600 mt-1">
                            {accountsLoadError}. Your inbox can still receive messages from previously configured accounts.
                        </p>
                        <button
                            onClick={fetchAccounts}
                            className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 transition-colors text-sm font-medium"
                        >
                            Retry
                        </button>
                    </div>
                ) : (
                    <EmailAccountList
                        accounts={accounts}
                        onEdit={setEditingAccount}
                        onDelete={handleDelete}
                        onAdd={() => setEditingAccount({ smtpEnabled: false, imapEnabled: false })}
                        onSetDefault={handleSetDefault}
                    />
                )
            )}

            {editingAccount && (
                <EmailAccountForm
                    initialData={editingAccount}
                    onSave={handleSave}
                    onCancel={() => setEditingAccount(null)}
                    onTest={handleTestConnection}
                    isSaving={isSaving}
                    isTesting={isTesting}
                    testResult={testResult}
                />
            )}
        </div>
    );
}
