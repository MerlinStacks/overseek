
import { useState, useEffect, useCallback, type MouseEvent } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Plus, Users, Edit2, Trash2, Search, Loader2 } from 'lucide-react';
import { SegmentBuilder, SegmentCriteria } from '../components/segments/SegmentBuilder';
import { Modal } from '../components/ui/Modal';
import { Pagination } from '../components/ui/Pagination';
import { useToast } from '../context/ToastContext';
import { useNavigate } from 'react-router-dom';

interface Segment {
    id: string;
    name: string;
    description: string;
    criteria: SegmentCriteria;
    campaigns?: Array<Record<string, unknown>>;
    _count?: { campaigns: number };
}

interface SegmentPreviewCustomer {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    ordersCount: number;
    totalSpent: number | null;
}

interface SegmentsPageProps {
    embedded?: boolean;
}

export function SegmentsPage({ embedded = false }: SegmentsPageProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [segments, setSegments] = useState<Segment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [editingSegment, setEditingSegment] = useState<Segment | null>(null);
    const [segmentName, setSegmentName] = useState('');
    const [segmentDesc, setSegmentDesc] = useState('');
    const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
    const [previewCustomers, setPreviewCustomers] = useState<SegmentPreviewCustomer[]>([]);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [previewPage, setPreviewPage] = useState(1);
    const [previewPageSize] = useState(25);
    const [previewTotal, setPreviewTotal] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [segmentToDelete, setSegmentToDelete] = useState<Segment | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const navigate = useNavigate();
    const toast = useToast();
    const fetchSegments = useCallback(async () => {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch(`/api/segments`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setSegments(data);
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchSegments();
    }, [fetchSegments]);

    async function handleSave(criteria: SegmentCriteria) {
        if (!currentAccount || !token) return;

        if (!segmentName.trim()) {
            toast.error('Please enter a segment name');
            return;
        }

        const data = {
            name: segmentName.trim(),
            description: segmentDesc.trim(),
            criteria
        };

        setIsSaving(true);
        try {
            let res;
            if (editingSegment) {
                res = await fetch(`/api/segments/${editingSegment.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id
                    },
                    body: JSON.stringify(data)
                });
            } else {
                res = await fetch(`/api/segments`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id
                    },
                    body: JSON.stringify(data)
                });
            }

            if (res.ok) {
                setIsCreating(false);
                setEditingSegment(null);
                setSegmentName('');
                setSegmentDesc('');
                fetchSegments();
                toast.success(editingSegment ? 'Segment updated' : 'Segment created');
            } else {
                const err = await res.json().catch(() => null);
                toast.error(err?.error || 'Failed to save segment');
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
            toast.error('Failed to save segment - network error');
        } finally {
            setIsSaving(false);
        }
    }

    async function handleDelete(id: string) {
        if (!currentAccount?.id) {
            toast.error('Select an account before deleting a segment');
            return;
        }

        setIsDeleting(true);
        try {
            const res = await fetch(`/api/segments/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (res.ok) {
                if (selectedSegment?.id === id) {
                    setSelectedSegment(null);
                    setPreviewCustomers([]);
                    setPreviewTotal(0);
                }
                setSegmentToDelete(null);
                await fetchSegments();
                toast.success('Segment deleted');
            } else {
                const err = await res.json().catch(() => null);
                toast.error(err?.error || 'Failed to delete segment');
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
            toast.error('Failed to delete segment');
        } finally {
            setIsDeleting(false);
        }
    }

    async function fetchSegmentPreview(segment: Segment, page: number) {
        if (!currentAccount || !token) return;

        try {
            setIsLoadingPreview(true);

            const res = await fetch(`/api/segments/${segment.id}/preview?page=${page}&pageSize=${previewPageSize}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok) {
                const data = await res.json();
                setPreviewCustomers(data.customers || []);
                setPreviewTotal(data.pagination?.total || 0);
                setPreviewPage(data.pagination?.page || page);
            } else {
                const err = await res.json().catch(() => null);
                toast.error(err?.error || 'Failed to load segment members');
                setPreviewCustomers([]);
                setPreviewTotal(0);
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
            toast.error('Failed to load segment members');
            setPreviewCustomers([]);
            setPreviewTotal(0);
        } finally {
            setIsLoadingPreview(false);
        }
    }

    async function handlePreview(segment: Segment) {
        setSelectedSegment(segment);
        await fetchSegmentPreview(segment, 1);
    }

    async function handlePreviewPageChange(nextPage: number) {
        if (!selectedSegment) return;
        await fetchSegmentPreview(selectedSegment, nextPage);
    }

    function handleCustomerRowClick(event: MouseEvent<HTMLTableRowElement>, customerId: string) {
        const href = `/customers/${encodeURIComponent(customerId)}`;
        if (event.metaKey || event.ctrlKey) {
            window.open(href, '_blank', 'noopener,noreferrer');
            return;
        }
        navigate(href);
    }

    function handleCustomerRowAuxClick(event: MouseEvent<HTMLTableRowElement>, customerId: string) {
        if (event.button !== 1) return;
        event.preventDefault();
        const href = `/customers/${encodeURIComponent(customerId)}`;
        window.open(href, '_blank', 'noopener,noreferrer');
    }

    if (isCreating || editingSegment) {
        return (
            <div className="space-y-6 max-w-4xl mx-auto">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{editingSegment ? 'Edit Segment' : 'Create New Segment'}</h1>
                        <p className="text-sm text-gray-500">Define criteria to group your customers.</p>
                    </div>

                    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-xs space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Segment Name</label>
                            <input
                                type="text"
                                className="w-full border border-gray-300 rounded-sm px-3 py-2 outline-hidden focus:ring-2 focus:ring-blue-500"
                                placeholder="e.g. VIP Customers"
                                value={segmentName}
                                onChange={e => setSegmentName(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
                            <input
                                type="text"
                                className="w-full border border-gray-300 rounded-sm px-3 py-2 outline-hidden focus:ring-2 focus:ring-blue-500"
                                placeholder="Customers who spent over $500"
                                value={segmentDesc}
                                onChange={e => setSegmentDesc(e.target.value)}
                            />
                        </div>
                    </div>

                    <SegmentBuilder
                        initialCriteria={editingSegment?.criteria}
                        onSave={handleSave}
                        isSaving={isSaving}
                        onCancel={() => {
                            setIsCreating(false);
                            setEditingSegment(null);
                            setSegmentName('');
                            setSegmentDesc('');
                        }}
                    />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                {!embedded && <div>
                    <h1 className="text-2xl font-bold text-gray-900">Segments</h1>
                    <p className="text-sm text-gray-500">Manage customer groups for targeted marketing</p>
                </div>}
                <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                    <div className="relative sm:w-72">
                        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Search segments..."
                            className="min-h-10 w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                        />
                    </div>
                    <button
                    onClick={() => {
                        setSegmentName('');
                        setSegmentDesc('');
                        setIsCreating(true);
                    }}
                    className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-700"
                >
                    <Plus size={18} />
                    Create segment
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {segments.filter((segment) => `${segment.name} ${segment.description || ''}`.toLowerCase().includes(searchQuery.trim().toLowerCase())).map(segment => (
                    <div key={segment.id} className={`bg-white p-5 rounded-xl border shadow-xs transition ${selectedSegment?.id === segment.id ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-gray-300 hover:shadow-md'}`}>
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
                                <Users size={24} />
                            </div>
                            <div className="flex items-center gap-1 rounded-lg border border-gray-100 bg-white p-1 shadow-xs">
                                <button
                                    onClick={() => {
                                        setSegmentName(segment.name);
                                        setSegmentDesc(segment.description || '');
                                        setEditingSegment(segment);
                                    }}
                                    title="Edit segment"
                                    className="p-1.5 text-gray-500 hover:text-indigo-600 rounded-sm hover:bg-indigo-50"
                                >
                                    <Edit2 size={16} />
                                </button>
                                <button
                                    onClick={() => setSegmentToDelete(segment)}
                                    title="Delete segment"
                                    className="p-1.5 text-gray-500 hover:text-red-600 rounded-sm hover:bg-red-50"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>

                        <h3 className="text-lg font-semibold text-gray-900 mb-1">{segment.name}</h3>
                        <p className="text-sm text-gray-500 line-clamp-2 h-10 mb-4">{segment.description || 'No description'}</p>

                        <div className="flex items-center gap-4 text-xs font-medium text-gray-500 border-t border-gray-100 pt-4">
                            <span className="flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                                {segment.criteria?.type} Logic
                            </span>
                            <span>
                                {segment.criteria?.rules?.length || 0} Conditions
                            </span>
                            <span>
                                {segment._count?.campaigns || 0} Campaigns
                            </span>
                        </div>

                        <button
                            onClick={() => handlePreview(segment)}
                            className="mt-4 w-full rounded-lg border border-indigo-200 bg-indigo-50 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                        >
                            View Members
                        </button>
                    </div>
                ))}

                {isLoading && (
                    <div className="col-span-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-16 text-sm text-gray-500">
                        <Loader2 size={18} className="animate-spin" /> Loading segments...
                    </div>
                )}

                {segments.length === 0 && !isLoading && (
                    <div className="col-span-full py-12 text-center text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                        <Users size={48} className="mx-auto mb-4 opacity-50" />
                        <p className="text-lg font-medium text-gray-900">No segments yet</p>
                        <p className="text-sm mb-6">Create your first segment to start targeting customers.</p>
                        <button
                            onClick={() => setIsCreating(true)}
                            className="text-blue-600 hover:underline"
                        >
                            Create Segment
                        </button>
                    </div>
                )}

                {segments.length > 0 && !isLoading && segments.filter((segment) => `${segment.name} ${segment.description || ''}`.toLowerCase().includes(searchQuery.trim().toLowerCase())).length === 0 && (
                    <div className="col-span-full rounded-xl border border-dashed border-gray-300 bg-gray-50 py-12 text-center text-sm text-gray-500">
                        No segments match “{searchQuery}”.
                    </div>
                )}
            </div>

            {selectedSegment && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-xs">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">{selectedSegment.name} Members</h2>
                            <p className="text-xs text-gray-500">Showing {previewCustomers.length} of {previewTotal} matching customers.</p>
                        </div>
                        <button
                            onClick={() => {
                                setSelectedSegment(null);
                                setPreviewCustomers([]);
                                setPreviewTotal(0);
                                setPreviewPage(1);
                            }}
                            className="text-sm text-gray-500 hover:text-gray-700"
                        >
                            Close
                        </button>
                    </div>

                    {isLoadingPreview ? (
                        <div className="px-5 py-8 text-sm text-gray-500">Loading members...</div>
                    ) : previewCustomers.length === 0 ? (
                        <div className="px-5 py-8 text-sm text-gray-500">No customers match this segment.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-gray-600">
                                    <tr>
                                        <th className="text-left px-5 py-3 font-medium">Customer</th>
                                        <th className="text-left px-5 py-3 font-medium">Email</th>
                                        <th className="text-left px-5 py-3 font-medium">Orders</th>
                                        <th className="text-left px-5 py-3 font-medium">Total Spent</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewCustomers.map(customer => (
                                        <tr
                                            key={customer.id}
                                            className="border-t border-gray-100 hover:bg-blue-50/60 cursor-pointer"
                                            onClick={(event) => handleCustomerRowClick(event, customer.id)}
                                            onMouseDown={(event) => handleCustomerRowAuxClick(event, customer.id)}
                                        >
                                            <td className="px-5 py-3 text-gray-900">
                                                {`${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unnamed customer'}
                                            </td>
                                            <td className="px-5 py-3 text-gray-700">{customer.email || 'No email'}</td>
                                            <td className="px-5 py-3 text-gray-700">{customer.ordersCount || 0}</td>
                                            <td className="px-5 py-3 text-gray-700">${Number(customer.totalSpent || 0).toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {previewTotal > previewPageSize && (
                        <Pagination
                            currentPage={previewPage}
                            totalPages={Math.max(1, Math.ceil(previewTotal / previewPageSize))}
                            onPageChange={(page) => void handlePreviewPageChange(page)}
                            className="pr-4"
                        />
                    )}
                </div>
            )}

            <Modal
                isOpen={Boolean(segmentToDelete)}
                onClose={isDeleting ? undefined : () => setSegmentToDelete(null)}
                title="Delete segment?"
            >
                <p className="text-sm leading-6 text-slate-600">
                    <strong className="text-slate-900">{segmentToDelete?.name}</strong> will be permanently removed. This cannot be undone.
                </p>
                <div className="mt-6 flex justify-end gap-3">
                    <button onClick={() => setSegmentToDelete(null)} disabled={isDeleting} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                        Cancel
                    </button>
                    <button onClick={() => segmentToDelete && void handleDelete(segmentToDelete.id)} disabled={isDeleting} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
                        {isDeleting && <Loader2 size={16} className="animate-spin" />}
                        Delete segment
                    </button>
                </div>
            </Modal>
        </div>
    );
}
