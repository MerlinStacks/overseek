import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Mail, Plus, ShieldOff, UserPlus, Users } from 'lucide-react';
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

interface BulkUnsubscribeResult {
    processed: number;
    created: number;
    updated: number;
    matchedCustomers?: number;
    matchedWithOrders?: number;
    unmatchedCount?: number;
    unmatchedEmailsSample?: string[];
    invalidCount?: number;
}

interface EmailListsPageProps {
    embedded?: boolean;
}

export function EmailListsPage({ embedded = false }: EmailListsPageProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();

    const [lists, setLists] = useState<EmailListItem[]>([]);
    const [selectedListId, setSelectedListId] = useState<string>('');
    const [members, setMembers] = useState<EmailListMember[]>([]);
    const [isLoadingLists, setIsLoadingLists] = useState(false);
    const [isLoadingMembers, setIsLoadingMembers] = useState(false);
    const [newListName, setNewListName] = useState('');
    const [newMemberEmail, setNewMemberEmail] = useState('');
    const [bulkUnsubscribeInput, setBulkUnsubscribeInput] = useState('');
    const [bulkUnsubscribeReason, setBulkUnsubscribeReason] = useState('');
    const [bulkUnsubscribeScope, setBulkUnsubscribeScope] = useState<'MARKETING' | 'ALL'>('MARKETING');
    const [isBulkUploading, setIsBulkUploading] = useState(false);
    const [lastBulkUnsubscribeResult, setLastBulkUnsubscribeResult] = useState<BulkUnsubscribeResult | null>(null);

    const fetchLists = useCallback(async () => {
        if (!currentAccount) return;
        setIsLoadingLists(true);
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
        } finally {
            setIsLoadingLists(false);
        }
    }, [currentAccount, selectedListId, token]);

    const fetchMembers = useCallback(async (listId: string) => {
        if (!currentAccount || !listId) return;
        setIsLoadingMembers(true);
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
        } finally {
            setIsLoadingMembers(false);
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
            setLastBulkUnsubscribeResult(data as BulkUnsubscribeResult);
            const invalidSuffix = data.invalidCount ? `, ${data.invalidCount} invalid` : '';
            const matchedWithOrders = typeof data.matchedWithOrders === 'number' ? data.matchedWithOrders : 0;
            const unmatchedCount = typeof data.unmatchedCount === 'number' ? data.unmatchedCount : 0;
            toast.success(`Processed ${data.processed} emails (${data.created} new, ${data.updated} updated${invalidSuffix}). ${matchedWithOrders} match customers with orders, ${unmatchedCount} unmatched.`);
            await fetchLists();
            if (selectedListId) await fetchMembers(selectedListId);
        } catch (error) {
            Logger.error('Bulk unsubscribe upload failed', { error });
            toast.error('Bulk unsubscribe upload failed');
        } finally {
            setIsBulkUploading(false);
        }
    }

    const selectedList = lists.find((list) => list.id === selectedListId);
    const totalListMembers = lists.reduce((total, list) => total + (list._count?.memberships || 0), 0);
    const subscribedMembers = members.filter((member) => member.isSubscribed).length;
    const unsubscribedMembers = members.length - subscribedMembers;

    return (
        <div className="space-y-6">
            <div className={`flex flex-col gap-4 lg:flex-row lg:items-end ${embedded ? 'lg:justify-end' : 'lg:justify-between'}`}>
                {!embedded && <div className="flex flex-col gap-2">
                    <div className="inline-flex w-fit items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                        <Mail size={14} /> Broadcast targeting
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">Email Lists</h1>
                    <p className="max-w-2xl text-gray-500">Build reusable recipient lists, add contacts, and manage subscription status before sending campaigns.</p>
                </div>}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:min-w-[420px]">
                    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-xs">
                        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                            <Users size={14} /> Lists
                        </div>
                        <p className="mt-2 text-2xl font-semibold text-gray-900">{lists.length}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-xs">
                        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                            <UserPlus size={14} /> Contacts
                        </div>
                        <p className="mt-2 text-2xl font-semibold text-gray-900">{totalListMembers}</p>
                    </div>
                    <div className="col-span-2 rounded-xl border border-gray-200 bg-white p-3 shadow-xs sm:col-span-1">
                        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                            <CheckCircle2 size={14} /> Active Here
                        </div>
                        <p className="mt-2 text-2xl font-semibold text-gray-900">{subscribedMembers}</p>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                <div className="rounded-2xl border border-gray-200 bg-white shadow-xs">
                    <div className="border-b border-gray-100 p-4">
                        <h2 className="text-sm font-semibold text-gray-900">Create a list</h2>
                        <p className="mt-1 text-sm text-gray-500">Name it by audience or campaign purpose.</p>
                        <form onSubmit={handleCreateList} className="mt-4 flex flex-col gap-2 sm:flex-row xl:flex-col">
                            <input
                                className="min-h-10 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-hidden transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                placeholder="VIP customers, newsletter, trade leads..."
                                value={newListName}
                                onChange={(e) => setNewListName(e.target.value)}
                            />
                            <button
                                type="submit"
                                disabled={!newListName.trim()}
                                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Plus size={16} /> Create list
                            </button>
                        </form>
                    </div>

                    <div className="p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <h2 className="text-sm font-semibold text-gray-900">Lists</h2>
                            {isLoadingLists && <Loader2 size={16} className="animate-spin text-gray-400" />}
                        </div>
                        <div className="max-h-[440px] space-y-2 overflow-y-auto pr-1">
                            {lists.map((list) => {
                                const isSelected = selectedListId === list.id;
                                return (
                                    <button
                                        key={list.id}
                                        onClick={() => setSelectedListId(list.id)}
                                        className={`w-full rounded-xl border p-3 text-left transition ${
                                            isSelected
                                                ? 'border-indigo-300 bg-indigo-50 shadow-xs ring-2 ring-indigo-100'
                                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold text-gray-900">{list.name}</div>
                                                {list.description && <div className="mt-1 line-clamp-2 text-xs text-gray-500">{list.description}</div>}
                                            </div>
                                            <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${isSelected ? 'bg-white text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                                                {list._count?.memberships || 0}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}

                            {!isLoadingLists && lists.length === 0 && (
                                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-center">
                                    <Users className="mx-auto text-gray-400" size={28} />
                                    <p className="mt-2 text-sm font-medium text-gray-900">No lists yet</p>
                                    <p className="mt-1 text-xs text-gray-500">Create your first list to start adding recipients.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white shadow-xs">
                    <div className="border-b border-gray-100 p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Selected list</p>
                                <h2 className="mt-1 text-xl font-semibold text-gray-900">{selectedList?.name || 'Choose a list'}</h2>
                                <p className="mt-1 text-sm text-gray-500">
                                    {selectedList ? 'Add recipients and toggle subscription status for this audience.' : 'Pick a list on the left to manage its contacts.'}
                                </p>
                            </div>

                            <div className="grid grid-cols-3 gap-2 lg:min-w-[300px]">
                                <div className="rounded-xl bg-gray-50 p-3 text-center">
                                    <p className="text-xs text-gray-500">Total</p>
                                    <p className="mt-1 text-lg font-semibold text-gray-900">{members.length}</p>
                                </div>
                                <div className="rounded-xl bg-emerald-50 p-3 text-center">
                                    <p className="text-xs text-emerald-700">Subscribed</p>
                                    <p className="mt-1 text-lg font-semibold text-emerald-800">{subscribedMembers}</p>
                                </div>
                                <div className="rounded-xl bg-gray-100 p-3 text-center">
                                    <p className="text-xs text-gray-600">Off</p>
                                    <p className="mt-1 text-lg font-semibold text-gray-800">{unsubscribedMembers}</p>
                                </div>
                            </div>
                        </div>

                        <form onSubmit={handleAddMember} className="mt-4 flex flex-col gap-2 sm:flex-row">
                            <input
                                className="min-h-11 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-hidden transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50 disabled:text-gray-400"
                                placeholder="customer@email.com"
                                value={newMemberEmail}
                                onChange={(e) => setNewMemberEmail(e.target.value)}
                                disabled={!selectedListId}
                            />
                            <button
                                type="submit"
                                disabled={!selectedListId || !newMemberEmail.trim()}
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <UserPlus size={16} /> Add contact
                            </button>
                        </form>
                    </div>

                    <div className="p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="text-sm font-semibold text-gray-900">Contacts</h3>
                            {isLoadingMembers && <Loader2 size={16} className="animate-spin text-gray-400" />}
                        </div>

                        <div className="max-h-[520px] overflow-y-auto rounded-xl border border-gray-200">
                            {members.map((member) => (
                                <div key={member.id} className="flex flex-col gap-3 border-b border-gray-100 p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${member.isSubscribed ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                                            {member.isSubscribed ? <CheckCircle2 size={18} /> : <ShieldOff size={18} />}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-gray-900">{member.email}</p>
                                            <p className="text-xs text-gray-500">{member.isSubscribed ? 'Can receive campaigns from this list' : 'Suppressed from this list'}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleToggleMember(member)}
                                        className={`inline-flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-medium transition ${
                                            member.isSubscribed
                                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                    >
                                        {member.isSubscribed ? 'Subscribed' : 'Unsubscribed'}
                                    </button>
                                </div>
                            ))}

                            {!isLoadingMembers && selectedListId && members.length === 0 && (
                                <div className="p-8 text-center">
                                    <UserPlus className="mx-auto text-gray-400" size={30} />
                                    <p className="mt-2 text-sm font-medium text-gray-900">No contacts in this list</p>
                                    <p className="mt-1 text-xs text-gray-500">Add an email above to start building this audience.</p>
                                </div>
                            )}

                            {!selectedListId && (
                                <div className="p-8 text-center">
                                    <Users className="mx-auto text-gray-400" size={30} />
                                    <p className="mt-2 text-sm font-medium text-gray-900">Select a list</p>
                                    <p className="mt-1 text-xs text-gray-500">List contacts and subscription controls will appear here.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-red-100 bg-white shadow-xs">
                <div className="border-b border-red-100 bg-red-50/70 p-4">
                    <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-lg bg-white p-2 text-red-600 shadow-xs">
                            <AlertTriangle size={18} />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold text-gray-900">Bulk unsubscribe upload</h2>
                            <p className="mt-1 text-sm text-gray-600">
                                Paste emails separated by commas, spaces, or new lines. This suppresses recipients in bulk.
                            </p>
                        </div>
                    </div>
                </div>

                <form onSubmit={handleBulkUnsubscribeUpload} className="space-y-4 p-4">
                    <textarea
                        className="min-h-36 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-hidden transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
                        placeholder="customer1@email.com\ncustomer2@email.com"
                        value={bulkUnsubscribeInput}
                        onChange={(e) => setBulkUnsubscribeInput(e.target.value)}
                    />

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <select
                            value={bulkUnsubscribeScope}
                            onChange={(e) => setBulkUnsubscribeScope(e.target.value as 'MARKETING' | 'ALL')}
                            className="min-h-10 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-hidden transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
                        >
                            <option value="MARKETING">Marketing only</option>
                            <option value="ALL">All email</option>
                        </select>

                        <input
                            className="min-h-10 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-hidden transition focus:border-red-500 focus:ring-2 focus:ring-red-100 md:col-span-2"
                            placeholder="Reason (optional)"
                            value={bulkUnsubscribeReason}
                            onChange={(e) => setBulkUnsubscribeReason(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-gray-500">Use carefully: these contacts may be excluded from future sends depending on scope.</p>
                        <button
                            type="submit"
                            disabled={isBulkUploading || !bulkUnsubscribeInput.trim()}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isBulkUploading && <Loader2 size={16} className="animate-spin" />}
                            {isBulkUploading ? 'Uploading...' : 'Upload unsubscribes'}
                        </button>
                    </div>
                </form>

                {lastBulkUnsubscribeResult && (
                    <div className="border-t border-gray-100 bg-gray-50 p-4">
                        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                            <div className="rounded-lg bg-white p-3">
                                <p className="text-xs text-gray-500">Processed</p>
                                <p className="mt-1 font-semibold text-gray-900">{lastBulkUnsubscribeResult.processed}</p>
                            </div>
                            <div className="rounded-lg bg-white p-3">
                                <p className="text-xs text-gray-500">Created / Updated</p>
                                <p className="mt-1 font-semibold text-gray-900">{lastBulkUnsubscribeResult.created} / {lastBulkUnsubscribeResult.updated}</p>
                            </div>
                            <div className="rounded-lg bg-white p-3">
                                <p className="text-xs text-gray-500">Matched customers</p>
                                <p className="mt-1 font-semibold text-gray-900">{lastBulkUnsubscribeResult.matchedCustomers ?? 0}</p>
                            </div>
                            <div className="rounded-lg bg-white p-3">
                                <p className="text-xs text-gray-500">Unmatched / Invalid</p>
                                <p className="mt-1 font-semibold text-gray-900">{lastBulkUnsubscribeResult.unmatchedCount ?? 0} / {lastBulkUnsubscribeResult.invalidCount ?? 0}</p>
                            </div>
                        </div>
                        {!!(lastBulkUnsubscribeResult.unmatchedEmailsSample && lastBulkUnsubscribeResult.unmatchedEmailsSample.length > 0) && (
                            <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600">
                                <span className="font-medium text-gray-700">Sample unmatched:</span> {lastBulkUnsubscribeResult.unmatchedEmailsSample.slice(0, 5).join(', ')}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
