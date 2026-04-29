import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useToast } from '../../context/ToastContext';
import { Logger } from '../../utils/logger';

interface EmailSuppression {
    id: string;
    email: string;
    scope: 'MARKETING' | 'ALL';
    reason?: string | null;
    createdAt: string;
}

export function EmailSuppressionPanel() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();
    const [items, setItems] = useState<EmailSuppression[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [email, setEmail] = useState('');
    const [scope, setScope] = useState<'MARKETING' | 'ALL'>('MARKETING');
    const [reason, setReason] = useState('');

    useEffect(() => {
        const fetchSuppressions = async () => {
            if (!token || !currentAccount) return;

            try {
                const response = await fetch('/api/email/suppressions', {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    setItems(data);
                }
            } catch (error) {
                Logger.error('Failed to load email suppressions', { error });
            } finally {
                setIsLoading(false);
            }
        };

        fetchSuppressions();
    }, [currentAccount, token]);

    const handleAdd = async () => {
        if (!token || !currentAccount || !email.trim()) return;
        setIsSaving(true);

        try {
            const response = await fetch('/api/email/suppressions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({
                    email: email.trim(),
                    scope,
                    reason: reason.trim() || undefined
                })
            });

            if (!response.ok) {
                throw new Error('Failed to save suppression');
            }

            const saved = await response.json();
            setItems((current) => {
                const withoutExisting = current.filter((item) => item.id !== saved.id && item.email !== saved.email);
                return [saved, ...withoutExisting];
            });
            setEmail('');
            setScope('MARKETING');
            setReason('');
        } catch (error) {
            Logger.error('Failed to save email suppression', { error });
            toast.error('Failed to save email suppression.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!token || !currentAccount) return;

        try {
            const response = await fetch(`/api/email/suppressions/${id}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            if (!response.ok) {
                throw new Error('Failed to delete suppression');
            }

            setItems((current) => current.filter((item) => item.id !== id));
        } catch (error) {
            Logger.error('Failed to delete email suppression', { error });
            toast.error('Failed to delete email suppression.');
        }
    };

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-xs">
            <div className="mb-4">
                <h3 className="font-medium text-gray-900">Suppression List</h3>
                <p className="text-sm text-gray-500">Manage recipients who should stop receiving marketing or all email.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-[1.6fr_0.8fr_1fr_auto]">
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="customer@example.com"
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                />
                <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value === 'ALL' ? 'ALL' : 'MARKETING')}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                >
                    <option value="MARKETING">Marketing Only</option>
                    <option value="ALL">All Email</option>
                </select>
                <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (optional)"
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                />
                <button
                    onClick={handleAdd}
                    disabled={isSaving || !email.trim()}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                    {isSaving ? 'Saving...' : 'Add'}
                </button>
            </div>

            <div className="mt-4 space-y-2">
                {isLoading ? (
                    <div className="text-sm text-gray-500">Loading suppressions...</div>
                ) : items.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500">
                        No suppressed recipients yet.
                    </div>
                ) : (
                    items.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-gray-900">{item.email}</div>
                                <div className="text-xs text-gray-500">
                                    {item.scope === 'ALL' ? 'All email blocked' : 'Marketing blocked'}
                                    {item.reason ? ` · ${item.reason}` : ''}
                                </div>
                            </div>
                            <div className="text-xs text-gray-400">
                                {new Date(item.createdAt).toLocaleDateString()}
                            </div>
                            <button
                                onClick={() => handleDelete(item.id)}
                                className="rounded-md p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                title="Remove suppression"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
