import { useEffect, useState, useCallback, useRef } from 'react';
import { Logger } from '../utils/logger';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Search, Users, Mail, ShoppingBag, Calendar, Loader2, ShieldCheck } from 'lucide-react';
import { Pagination } from '../components/ui/Pagination';
import { TableSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { RelativeTime } from '../components/ui/RelativeTime';
import { formatDate, formatCurrency } from '../utils/format';
import { subscribeToCrossTabEvents } from '../utils/productCrossTabEvents';
import { useVisibilityRefreshThrottle } from '../hooks/useVisibilityRefreshThrottle';
import { useToast } from '../context/ToastContext';

type ContactStatus = 'UNVERIFIED' | 'SUBSCRIBED' | 'BOUNCED' | 'UNSUBSCRIBED' | 'SOFT_BOUNCED' | 'COMPLAINT' | 'BLOCKED';

interface Contact {
    id: string;
    wooId: number | null;
    firstName: string | null;
    lastName: string | null;
    email: string;
    totalSpent: number;
    ordersCount: number;
    dateCreated: string;
    contactStatus: ContactStatus;
    isCustomer: boolean;
    blockedReason?: string | null;
    blockedAt?: string | null;
    blockedByName?: string | null;
}

function getContactStatusBadge(status: Contact['contactStatus']) {
    switch (status || 'SUBSCRIBED') {
        case 'UNVERIFIED':
            return { label: 'Unverified', className: 'bg-gray-100 text-gray-700 border-gray-200' };
        case 'SUBSCRIBED':
            return { label: 'Subscribed', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
        case 'BOUNCED':
            return { label: 'Bounced', className: 'bg-red-100 text-red-700 border-red-200' };
        case 'UNSUBSCRIBED':
            return { label: 'Unsubscribed', className: 'bg-amber-100 text-amber-700 border-amber-200' };
        case 'SOFT_BOUNCED':
            return { label: 'Soft Bounced', className: 'bg-orange-100 text-orange-700 border-orange-200' };
        case 'COMPLAINT':
            return { label: 'Complaint', className: 'bg-rose-100 text-rose-700 border-rose-200' };
        case 'BLOCKED':
            return { label: 'Blocked', className: 'bg-slate-800 text-white border-slate-800' };
        default:
            return { label: 'Subscribed', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
    }
}

export function CustomersPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();
    const pageFromUrl = Number(searchParams.get('page') || '1');
    const queryFromUrl = searchParams.get('q') || '';
    const statusFromUrl = searchParams.get('status');
    const initialStatusFilter: ContactStatus | 'ALL' =
        statusFromUrl === 'UNVERIFIED' ||
        statusFromUrl === 'SUBSCRIBED' ||
        statusFromUrl === 'BOUNCED' ||
        statusFromUrl === 'UNSUBSCRIBED' ||
        statusFromUrl === 'SOFT_BOUNCED' ||
        statusFromUrl === 'COMPLAINT' ||
        statusFromUrl === 'BLOCKED'
            ? statusFromUrl
            : 'ALL';
    const initialPage = Number.isFinite(pageFromUrl) && pageFromUrl > 0 ? Math.trunc(pageFromUrl) : 1;
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState(queryFromUrl);
    const [page, setPage] = useState(initialPage);
    const [limit, setLimit] = useState(20);
    const [totalPages, setTotalPages] = useState(1);
    const [statusFilter, setStatusFilter] = useState<ContactStatus | 'ALL'>(initialStatusFilter);
    const [statusCounts, setStatusCounts] = useState<Record<ContactStatus | 'ALL', number>>({
        ALL: 0,
        UNVERIFIED: 0,
        SUBSCRIBED: 0,
        BOUNCED: 0,
        UNSUBSCRIBED: 0,
        SOFT_BOUNCED: 0,
        COMPLAINT: 0,
        BLOCKED: 0
    });
    const [unblockingEmail, setUnblockingEmail] = useState<string | null>(null);
    const fetchRequestId = useRef(0);

    const [debouncedQuery, setDebouncedQuery] = useState(queryFromUrl);
    const currency = currentAccount?.currency || 'USD';
    const shouldRefreshOnVisible = useVisibilityRefreshThrottle(45_000);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(searchQuery);
            if (searchQuery !== queryFromUrl) {
                setPage(1);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery, queryFromUrl]);

    const fetchContacts = useCallback(async () => {
        if (!currentAccount || !token) return;

        const requestId = ++fetchRequestId.current;
        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString(),
                q: debouncedQuery,
                status: statusFilter
            });

            const res = await fetch(`/api/customers/contacts?${params}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok && requestId === fetchRequestId.current) {
                const data = await res.json();
                setContacts(data.contacts);
                setTotalPages(data.totalPages);
                if (data.statusCounts) {
                    setStatusCounts(data.statusCounts);
                }
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            if (requestId === fetchRequestId.current) setIsLoading(false);
        }
    }, [currentAccount, token, page, limit, debouncedQuery, statusFilter]);

    const handleUnblock = useCallback(async (email: string) => {
        if (!currentAccount || !token || !confirm(`Unblock ${email}?`)) return;

        setUnblockingEmail(email);
        try {
            const response = await fetch(`/api/chat/block/${encodeURIComponent(email)}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(payload?.error || 'Failed to unblock contact');
            }
            toast.success(`${email} unblocked.`);
            await fetchContacts();
        } catch (error) {
            Logger.error('Failed to unblock contact', { error, email });
            toast.error(error instanceof Error ? error.message : 'Failed to unblock contact.');
        } finally {
            setUnblockingEmail(null);
        }
    }, [currentAccount, token, toast, fetchContacts]);

    useEffect(() => {
        fetchContacts();
    }, [fetchContacts]);

    useEffect(() => {
        const unsubscribe = subscribeToCrossTabEvents((event) => {
            if (event.resource !== 'customer' || event.accountId !== currentAccount?.id) {
                return;
            }

            void fetchContacts();
        });

        return unsubscribe;
    }, [currentAccount?.id, fetchContacts]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                if (!shouldRefreshOnVisible()) {
                    return;
                }
                void fetchContacts();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [fetchContacts, shouldRefreshOnVisible]);

    useEffect(() => {
        const nextParams = new URLSearchParams(searchParams);
        if (debouncedQuery) {
            nextParams.set('q', debouncedQuery);
        } else {
            nextParams.delete('q');
        }

        if (statusFilter !== 'ALL') {
            nextParams.set('status', statusFilter);
        } else {
            nextParams.delete('status');
        }

        if (page > 1) {
            nextParams.set('page', String(page));
        } else {
            nextParams.delete('page');
        }

        if (nextParams.toString() !== searchParams.toString()) {
            setSearchParams(nextParams, { replace: true });
        }
    }, [debouncedQuery, statusFilter, page, searchParams, setSearchParams]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-gray-900">Contacts</h1>
                    <p className="text-sm text-gray-500">Manage customers, email preferences, and blocked contacts</p>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
                    <button
                        onClick={() => navigate('/emails/audiences?tab=segments')}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
                    >
                        <Users size={16} />
                        Segments
                    </button>
                    <div className="relative flex-1 sm:flex-none">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Search contacts..."
                            className="w-full sm:w-64 pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-hidden focus:ring-2 focus:ring-blue-500"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                {[
                    ['ALL', 'All'],
                    ['SUBSCRIBED', 'Subscribed'],
                    ['UNVERIFIED', 'Unverified'],
                    ['UNSUBSCRIBED', 'Unsubscribed'],
                    ['BLOCKED', 'Blocked'],
                    ['SOFT_BOUNCED', 'Soft Bounced'],
                    ['BOUNCED', 'Bounced'],
                    ['COMPLAINT', 'Complaint']
                ].map(([value, label]) => (
                    <button
                        key={value}
                        onClick={() => {
                            setStatusFilter(value as typeof statusFilter);
                            setPage(1);
                        }}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${statusFilter === value
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        {label} {statusCounts[value as keyof typeof statusCounts] ?? 0}
                    </button>
                ))}
            </div>

            <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[600px]">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-semibold">
                                <th className="px-3 md:px-6 py-3 md:py-4">Email</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Contact</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Status</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Orders</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Total Spent</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Added</th>
                                <th className="px-3 md:px-6 py-3 md:py-4 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {isLoading ? (
                                <TableSkeleton rows={8} columns={7} showAvatar />
                            ) : contacts.length === 0 ? (
                                <tr><td colSpan={7}>
                                    <EmptyState
                                        icon={<Users size={48} />}
                                        title={statusFilter === 'ALL' ? 'No contacts found' : 'No contacts in this status'}
                                        description={statusFilter === 'ALL'
                                            ? 'Customers and blocked contacts will appear here.'
                                            : 'Try switching to another status filter or clear the search query.'}
                                    />
                                </td></tr>
                            ) : (
                                contacts.map((contact) => {
                                    const statusBadge = getContactStatusBadge(contact.contactStatus);
                                    return <tr
                                        key={`${contact.isCustomer ? 'customer' : 'contact'}-${contact.id}`}
                                        className={`${contact.isCustomer ? 'cursor-pointer' : ''} hover:bg-gray-50 transition-colors focus-within:bg-blue-50`}
                                        onClick={() => {
                                            if (contact.isCustomer) navigate(`/customers/${encodeURIComponent(contact.id)}`);
                                        }}
                                        onKeyDown={(event) => {
                                            if (contact.isCustomer && (event.key === 'Enter' || event.key === ' ')) {
                                                event.preventDefault();
                                                navigate(`/customers/${encodeURIComponent(contact.id)}`);
                                            }
                                        }}
                                        role={contact.isCustomer ? 'link' : undefined}
                                        tabIndex={contact.isCustomer ? 0 : undefined}
                                        aria-label={contact.isCustomer ? `Open ${contact.firstName} ${contact.lastName} profile` : undefined}
                                    >

                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3" title={contact.email}>
                                                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
                                                    {contact.firstName?.[0] || contact.email[0]?.toUpperCase()}{contact.lastName?.[0]}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-gray-900">
                                                        {contact.firstName || contact.lastName ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() : contact.email}
                                                    </div>
                                                    {!contact.isCustomer && <div className="text-xs text-gray-500">Contact</div>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            <div className="flex items-center gap-2">
                                                <Mail size={14} />
                                                {contact.email}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex max-w-52 flex-col items-start gap-1">
                                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadge.className}`}>
                                                    {statusBadge.label}
                                                </span>
                                                {contact.contactStatus === 'BLOCKED' && (contact.blockedReason || contact.blockedByName) && (
                                                    <span
                                                        className="max-w-full truncate text-xs text-gray-500"
                                                        title={[contact.blockedReason, contact.blockedByName ? `Blocked by ${contact.blockedByName}` : ''].filter(Boolean).join(' · ')}
                                                    >
                                                        {contact.blockedReason || `Blocked by ${contact.blockedByName}`}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            <div
                                                className="flex items-center gap-2 cursor-default"
                                                    title={`Total spent: ${formatCurrency(contact.totalSpent, currency)} across ${contact.ordersCount} order${contact.ordersCount !== 1 ? 's' : ''}`}
                                            >
                                                <ShoppingBag size={14} />
                                                {contact.ordersCount} order{contact.ordersCount !== 1 ? 's' : ''}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 font-medium text-gray-900">
                                            <span
                                                    title={`${contact.ordersCount} order${contact.ordersCount !== 1 ? 's' : ''} · Avg ${formatCurrency(contact.ordersCount > 0 ? contact.totalSpent / contact.ordersCount : 0, currency)}`}
                                                className="cursor-default border-b border-dotted border-gray-300"
                                            >
                                                {formatCurrency(contact.totalSpent, currency)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            <div className="flex items-center gap-2">
                                                <Calendar size={14} />
                                                <div>
                                                    <div>{formatDate(contact.dateCreated)}</div>
                                                    <RelativeTime date={contact.dateCreated} />
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {contact.contactStatus === 'BLOCKED' && (
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        void handleUnblock(contact.email);
                                                    }}
                                                    disabled={unblockingEmail === contact.email}
                                                    title={contact.blockedReason || `Blocked${contact.blockedByName ? ` by ${contact.blockedByName}` : ''}`}
                                                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    {unblockingEmail === contact.email ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                                                    Unblock
                                                </button>
                                            )}
                                        </td>
                                    </tr>;
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                {!isLoading && contacts.length > 0 && (
                    <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        itemsPerPage={limit}
                        onItemsPerPageChange={(newLimit) => {
                            setLimit(newLimit);
                            setPage(1);
                        }}
                        allowItemsPerPage={true}
                    />
                )}
            </div>
        </div >
    );
}
