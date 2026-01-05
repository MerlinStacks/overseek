// @ts-nocheck

import { useState, useEffect } from 'react';
import { Mail, Plus, Trash2, CheckCircle, XCircle, Loader2, Server, Globe, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface EmailAccount {
    id: string;
    name: string;
    email: string;
    host: string;
    port: number;
    username: string;
    type: 'SMTP' | 'IMAP';
    isSecure: boolean;
}

export function EmailSettings() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [accounts, setAccounts] = useState<EmailAccount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);

    const [editingAccount, setEditingAccount] = useState<Partial<EmailAccount> | null>(null);

    useEffect(() => {
        if (currentAccount && token) {
            fetchAccounts();
        }
    }, [currentAccount, token]);

    const fetchAccounts = async () => {
        try {
            const res = await fetch('/api/email/accounts', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setAccounts(data);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        if (!currentAccount || !token || !editingAccount) return;
        setIsSaving(true);
        setTestResult(null);

        try {
            const method = editingAccount.id ? 'PUT' : 'POST';
            const url = editingAccount.id
                ? `/api/email/accounts/${editingAccount.id}`
                : '/api/email/accounts';

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(editingAccount)
            });

            if (!res.ok) throw new Error('Failed to save account');

            await fetchAccounts();
            setEditingAccount(null);
        } catch (error) {
            console.error(error);
            alert('Failed to save account');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this account?')) return;
        try {
            await fetch(`/api/email/accounts/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setAccounts(accounts.filter(a => a.id !== id));
        } catch (error) {
            console.error(error);
            alert('Failed to delete account');
        }
    };

    const handleTestConnection = async () => {
        if (!editingAccount) return;
        setIsTesting(true);
        setTestResult(null);

        try {
            const res = await fetch('/api/email/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(editingAccount)
            });

            const data = await res.json();
            setTestResult({ success: data.success, message: data.error });
        } catch (error) {
            setTestResult({ success: false, message: 'Network error' });
        } finally {
            setIsTesting(false);
        }
    };

    if (isLoading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            {!editingAccount && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                        <div>
                            <h2 className="text-lg font-medium text-gray-900">Email Accounts</h2>
                            <p className="text-sm text-gray-500 mt-1">Manage SMTP and IMAP connections for sending and receiving emails.</p>
                        </div>
                        <button
                            onClick={() => setEditingAccount({ type: 'SMTP', port: 587, isSecure: true })}
                            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                        >
                            <Plus size={16} />
                            Add Account
                        </button>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {accounts.length === 0 ? (
                            <div className="p-10 text-center text-gray-500">
                                No email accounts configured.
                            </div>
                        ) : (
                            accounts.map(acc => (
                                <div key={acc.id} className="p-6 flex justify-between items-center hover:bg-gray-50 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
                                            <Mail size={20} />
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-gray-900">{acc.name}</h3>
                                            <p className="text-sm text-gray-500">{acc.email} • {acc.type} • {acc.host}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setEditingAccount(acc)}
                                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-gray-200"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleDelete(acc.id)}
                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-gray-200"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {editingAccount && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                        <h2 className="text-lg font-medium text-gray-900">
                            {editingAccount.id ? 'Edit Account' : 'New Email Account'}
                        </h2>
                        <button
                            onClick={() => setEditingAccount(null)}
                            className="text-gray-400 hover:text-gray-600"
                        >
                            <XCircle size={24} />
                        </button>
                    </div>

                    <div className="p-6 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                                <input
                                    type="text"
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="e.g. Support Inbox"
                                    value={editingAccount.name || ''}
                                    onChange={(e) => setEditingAccount({ ...editingAccount!, name: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                                <input
                                    type="email"
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="support@example.com"
                                    value={editingAccount.email || ''}
                                    onChange={(e) => setEditingAccount({ ...editingAccount!, email: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="border-t border-gray-100 pt-6">
                            <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-2">
                                <Server size={16} />
                                Server Settings
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Protocol</label>
                                    <select
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={editingAccount.type}
                                        onChange={(e) => setEditingAccount({ ...editingAccount!, type: e.target.value as 'SMTP' | 'IMAP' })}
                                    >
                                        <option value="SMTP">SMTP (Sending)</option>
                                        <option value="IMAP">IMAP (Receiving)</option>
                                    </select>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Host</label>
                                    <input
                                        type="text"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="smtp.gmail.com"
                                        value={editingAccount.host || ''}
                                        onChange={(e) => setEditingAccount({ ...editingAccount!, host: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                                    <input
                                        type="number"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="587"
                                        value={editingAccount.port || ''}
                                        onChange={(e) => setEditingAccount({ ...editingAccount!, port: parseInt(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                                    <input
                                        type="text"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={editingAccount.username || ''}
                                        onChange={(e) => setEditingAccount({ ...editingAccount!, username: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                                    <input
                                        type="password"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="••••••••"
                                        value={editingAccount.password || ''} // In real edit, we wouldn't show this or handle it carefully
                                        onChange={(e) => setEditingAccount({ ...editingAccount!, password: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="mt-4 flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="secure"
                                    checked={editingAccount.isSecure}
                                    onChange={(e) => setEditingAccount({ ...editingAccount!, isSecure: e.target.checked })}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <label htmlFor="secure" className="text-sm text-gray-700">Use Secure Connection (TLS/SSL)</label>
                            </div>
                        </div>

                        {/* Test Results */}
                        {testResult && (
                            <div className={`p-4 rounded-lg flex items-center gap-3 ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                {testResult.success ? <CheckCircle size={20} /> : <XCircle size={20} />}
                                <span className="text-sm font-medium">{testResult.success ? 'Connection Successful!' : `Connection Failed: ${testResult.message}`}</span>
                            </div>
                        )}

                        <div className="bg-gray-50 -mx-6 -mb-6 px-6 py-4 flex justify-between items-center rounded-b-xl border-t border-gray-100 mt-6">
                            <button
                                onClick={handleTestConnection}
                                disabled={isTesting || !editingAccount.host}
                                className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                            >
                                {isTesting ? 'Testing...' : 'Test Connection'}
                            </button>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setEditingAccount(null)}
                                    className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
                                >
                                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                    {isSaving ? 'Saving...' : 'Save Account'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
