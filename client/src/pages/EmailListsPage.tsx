import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useToast } from '../context/ToastContext';
import { Logger } from '../utils/logger';

interface EmailListItem {
    id: string;
    name: string;
    description?: string | null;
    _count?: { memberships?: number };
}

interface EmailListMember {
    id: string;
    email: string;
    isSubscribed: boolean;
}

export function EmailListsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();

    const [lists, setLists] = useState<EmailListItem[]>([]);
    const [selectedListId, setSelectedListId] = useState<string>('');
    const [members, setMembers] = useState<EmailListMember[]>([]);
    const [newListName, setNewListName] = useState('');
    const [newMemberEmail, setNewMemberEmail] = useState('');
    const [bulkUnsubscribeInput, setBulkUnsubscribeInput] = useState('');
    const [bulkUnsubscribeReason, setBulkUnsubscribeReason] = useState('');
    const [bulkUnsubscribeScope, setBulkUnsubscribeScope] = useState<'MARKETING' | 'ALL'>('MARKETING');
    const [isBulkUploading, setIsBulkUploading] = useState(false);

    const fetchLists = useCallback(async () => {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/email/lists', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                const nextLists = Array.isArray(data) ? data : [];
                setLists(nextLists);

                if (nextLists.length === 0) {
                    setSelectedListId('');
                    setMembers([]);
                    return;
                }

                const selectedStillExists = nextLists.some((list: EmailListItem) => list.id === selectedListId);
                if (!selectedListId || !selectedStillExists) {
                    setSelectedListId(nextLists[0].id);
                }
            }
        } catch (error) {
            Logger.error('Failed to fetch email lists', { error });
        }
    }, [currentAccount, selectedListId, token]);

    const fetchMembers = useCallback(async (listId: string) => {
        if (!currentAccount || !listId) return;
        try {
            const res = await fetch(`/api/email/lists/${listId}/members`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setMembers(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            Logger.error('Failed to fetch list members', { error });
        }
    }, [currentAccount, token]);

    useEffect(() => {
        void fetchLists();
    }, [fetchLists]);

    useEffect(() => {
        if (selectedListId) {
            void fetchMembers(selectedListId);
        }
    }, [fetchMembers, selectedListId]);

    async function handleCreateList(e: React.FormEvent) {
        e.preventDefault();
        const trimmedName = newListName.trim();
        if (!trimmedName) return;

        const duplicateExists = lists.some((list) => list.name.trim().toLowerCase() === trimmedName.toLowerCase());
        if (duplicateExists) {
            toast.error('A list with this name already exists');
            return;
        }

        const res = await fetch('/api/email/lists', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'x-account-id': currentAccount?.id || ''
            },
            body: JSON.stringify({ name: trimmedName })
        });

        if (!res.ok) {
            const data = await res.json().catch(() => null);
            toast.error(data?.error || 'Failed to create list');
            return;
        }

        const created = await res.json();
        setNewListName('');
        await fetchLists();
        setSelectedListId(created.id);
        toast.success('List created');
    }

    async function handleAddMember(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedListId || !newMemberEmail.trim()) return;

        const res = await fetch(`/api/email/lists/${selectedListId}/members`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'x-account-id': currentAccount?.id || ''
            },
            body: JSON.stringify({ email: newMemberEmail.trim(), isSubscribed: true, source: 'ADMIN' })
        });

        if (!res.ok) {
            toast.error('Failed to add member');
            return;
        }

        setNewMemberEmail('');
        await fetchMembers(selectedListId);
        await fetchLists();
    }

    async function handleToggleMember(member: EmailListMember) {
        if (!selectedListId) return;

        const res = await fetch(`/api/email/lists/${selectedListId}/members`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'x-account-id': currentAccount?.id || ''
            },
            body: JSON.stringify({ email: member.email, isSubscribed: !member.isSubscribed, source: 'ADMIN' })
        });

        if (res.ok) {
            await fetchMembers(selectedListId);
            await fetchLists();
        }
    }

    async function handleBulkUnsubscribeUpload(e: React.FormEvent) {
        e.preventDefault();
        if (!bulkUnsubscribeInput.trim() || !currentAccount) return;

        setIsBulkUploading(true);
        try {
            const res = await fetch('/api/email/unsubscribes/bulk', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({
                    payload: bulkUnsubscribeInput,
                    scope: bulkUnsubscribeScope,
                    reason: bulkUnsubscribeReason.trim() || undefined
                })
            });

            const data = await res.json();
            if (!res.ok) {
                toast.error(data?.error || 'Bulk unsubscribe upload failed');
                return;
            }

            setBulkUnsubscribeInput('');
            setBulkUnsubscribeReason('');
            const invalidSuffix = data.invalidCount ? `, ${data.invalidCount} invalid` : '';
            toast.success(`Processed ${data.processed} emails (${data.created} new, ${data.updated} updated${invalidSuffix})`);
            await fetchLists();
            if (selectedListId) await fetchMembers(selectedListId);
        } catch (error) {
            Logger.error('Bulk unsubscribe upload failed', { error });
            toast.error('Bulk unsubscribe upload failed');
        } finally {
            setIsBulkUploading(false);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Email Lists</h1>
                <p className="text-gray-500">Create lists and manage list subscribers for broadcast targeting.</p>
            </div>

            <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-4 space-y-4">
                <form onSubmit={handleCreateList} className="flex gap-2">
                    <input
                        className="flex-1 p-2 border rounded-sm"
                        placeholder="New list name"
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                    />
                    <button type="submit" className="px-3 py-2 bg-blue-600 text-white rounded-sm">Create</button>
                </form>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border rounded-lg p-3">
                        <div className="text-sm font-medium mb-2">Lists</div>
                        <div className="space-y-2 max-h-80 overflow-y-auto">
                            {lists.map((list) => (
                                <button
                                    key={list.id}
                                    onClick={() => setSelectedListId(list.id)}
                                    className={`w-full text-left p-2 rounded ${selectedListId === list.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'}`}
                                >
                                    <div className="font-medium text-sm text-gray-900">{list.name}</div>
                                    <div className="text-xs text-gray-500">{list._count?.memberships || 0} subscribed</div>
                                </button>
                            ))}
                            {lists.length === 0 && <p className="text-sm text-gray-500">No lists yet.</p>}
                        </div>
                    </div>

                    <div className="border rounded-lg p-3">
                        <div className="text-sm font-medium mb-2">Members</div>
                        <form onSubmit={handleAddMember} className="flex gap-2 mb-3">
                            <input
                                className="flex-1 p-2 border rounded-sm"
                                placeholder="customer@email.com"
                                value={newMemberEmail}
                                onChange={(e) => setNewMemberEmail(e.target.value)}
                            />
                            <button type="submit" className="px-3 py-2 bg-gray-900 text-white rounded-sm">Add</button>
                        </form>
                        <div className="space-y-2 max-h-80 overflow-y-auto">
                            {members.map((member) => (
                                <div key={member.id} className="flex items-center justify-between text-sm border rounded p-2">
                                    <span className="truncate pr-2">{member.email}</span>
                                    <button
                                        onClick={() => handleToggleMember(member)}
                                        className={`px-2 py-1 rounded text-xs ${member.isSubscribed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                                    >
                                        {member.isSubscribed ? 'Subscribed' : 'Unsubscribed'}
                                    </button>
                                </div>
                            ))}
                            {selectedListId && members.length === 0 && <p className="text-sm text-gray-500">No members yet.</p>}
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-4 space-y-3">
                <div>
                    <h2 className="text-sm font-semibold text-gray-900">Bulk Unsubscribe Upload</h2>
                    <p className="text-xs text-gray-500 mt-1">
                        Paste emails separated by commas, spaces, or new lines. Use this to suppress recipients at once.
                    </p>
                </div>

                <form onSubmit={handleBulkUnsubscribeUpload} className="space-y-3">
                    <textarea
                        className="w-full min-h-32 p-2 border rounded-sm"
                        placeholder="customer1@email.com\ncustomer2@email.com"
                        value={bulkUnsubscribeInput}
                        onChange={(e) => setBulkUnsubscribeInput(e.target.value)}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <select
                            value={bulkUnsubscribeScope}
                            onChange={(e) => setBulkUnsubscribeScope(e.target.value as 'MARKETING' | 'ALL')}
                            className="p-2 border rounded-sm"
                        >
                            <option value="MARKETING">Marketing only</option>
                            <option value="ALL">All email</option>
                        </select>

                        <input
                            className="md:col-span-2 p-2 border rounded-sm"
                            placeholder="Reason (optional)"
                            value={bulkUnsubscribeReason}
                            onChange={(e) => setBulkUnsubscribeReason(e.target.value)}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isBulkUploading || !bulkUnsubscribeInput.trim()}
                        className="px-3 py-2 bg-red-600 text-white rounded-sm disabled:opacity-60"
                    >
                        {isBulkUploading ? 'Uploading...' : 'Upload Unsubscribes'}
                    </button>
                </form>
            </div>
        </div>
    );
}
