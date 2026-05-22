import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldOff, Search, Loader2, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useToast } from '../context/ToastContext';
import { Logger } from '../utils/logger';

interface BlockedContact {
    email: string;
    reason?: string | null;
    blockedAt: string;
    blocker?: {
        fullName?: string | null;
    } | null;
}

export function BlockedContactsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();

    const [blockedContacts, setBlockedContacts] = useState<BlockedContact[]>([]);
    const [query, setQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [unblockingEmail, setUnblockingEmail] = useState<string | null>(null);

    const fetchBlockedContacts = useCallback(async () => {
        if (!token || !currentAccount) return;
        setIsLoading(true);

        try {
            const response = await fetch('/api/chat/blocked', {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                }
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(payload?.error || 'Failed to load blocked contacts');
            }

            const data = await response.json() as BlockedContact[];
            setBlockedContacts(Array.isArray(data) ? data : []);
        } catch (error) {
            Logger.error('Failed to load blocked contacts', { error });
            const message = error instanceof Error ? error.message : 'Failed to load blocked contacts.';
            toast.error(message);
        } finally {
            setIsLoading(false);
        }
    }, [token, currentAccount, toast]);

    useEffect(() => {
        fetchBlockedContacts();
    }, [fetchBlockedContacts]);

    const filteredContacts = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return blockedContacts;

        return blockedContacts.filter((contact) => {
            const blockerName = contact.blocker?.fullName || '';
            const reason = contact.reason || '';
            return (
                contact.email.toLowerCase().includes(needle)
                || blockerName.toLowerCase().includes(needle)
                || reason.toLowerCase().includes(needle)
            );
        });
    }, [blockedContacts, query]);

    const handleUnblock = useCallback(async (email: string) => {
        if (!token || !currentAccount) return;
        if (!confirm(`Unblock ${email}?`)) return;

        setUnblockingEmail(email);
        try {
            const response = await fetch(`/api/chat/block/${encodeURIComponent(email)}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                }
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(payload?.error || 'Failed to unblock contact');
            }

            toast.success(`${email} unblocked.`);
            setBlockedContacts((prev) => prev.filter((contact) => contact.email !== email));
        } catch (error) {
            Logger.error('Failed to unblock contact', { error, email });
            const message = error instanceof Error ? error.message : 'Failed to unblock contact.';
            toast.error(message);
        } finally {
            setUnblockingEmail(null);
        }
    }, [token, currentAccount, toast]);

    return (
        <div className="space-y-6 p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900">Blocked Contacts</h1>
                    <p className="mt-1 text-sm text-gray-500">Contacts blocked from inbox email notifications and auto-replies.</p>
                </div>
                <button
                    onClick={fetchBlockedContacts}
                    disabled={isLoading}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {isLoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldOff size={14} />}
                    Refresh
                </button>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-gray-500">Search</label>
                <div className="relative">
                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search by email, reason, or blocker"
                        className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                    />
                </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                {isLoading ? (
                    <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-gray-500">
                        <Loader2 size={16} className="animate-spin" />
                        Loading blocked contacts...
                    </div>
                ) : filteredContacts.length === 0 ? (
                    <div className="px-4 py-16 text-center text-sm text-gray-500">
                        No blocked contacts found.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Email</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Blocked At</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Blocked By</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Reason</th>
                                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredContacts.map((contact) => (
                                    <tr key={`${contact.email}-${contact.blockedAt}`}>
                                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{contact.email}</td>
                                        <td className="px-4 py-3 text-sm text-gray-600">{new Date(contact.blockedAt).toLocaleString()}</td>
                                        <td className="px-4 py-3 text-sm text-gray-600">{contact.blocker?.fullName || 'System'}</td>
                                        <td className="max-w-sm truncate px-4 py-3 text-sm text-gray-600" title={contact.reason || ''}>{contact.reason || '-'}</td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                onClick={() => handleUnblock(contact.email)}
                                                disabled={unblockingEmail === contact.email}
                                                className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {unblockingEmail === contact.email ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                                Unblock
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
