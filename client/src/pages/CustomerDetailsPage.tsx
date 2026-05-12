
import { useEffect, useState, useCallback } from 'react';
import { Logger } from '../utils/logger';
import { formatCurrency, formatDateSafe, formatTimeSafe, formatDateTimeSafe, toValidDate } from '../utils/format';
import { Mail, Calendar, Activity, Zap, Users } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { MergeCustomerModal } from '../components/customers/MergeCustomerModal';
import { subscribeToCrossTabEvents } from '../utils/productCrossTabEvents';

interface CustomerDetails {
    customer: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        totalSpent: number;
        ordersCount: number;
        dateCreated: string;
        rawData?: {
            billing?: {
                phone?: string;
                address_1?: string;
                address_2?: string;
                city?: string;
                state?: string;
                postcode?: string;
                country?: string;
            };
            [key: string]: unknown;
        };
        contactStatus?: 'UNVERIFIED' | 'SUBSCRIBED' | 'BOUNCED' | 'UNSUBSCRIBED' | 'SOFT_BOUNCED' | 'COMPLAINT';
    };
    orders: Array<{
        id: string;
        number: string;
        dateCreated: string;
        status: string;
        total: number | string;
        currency?: string;
    }>;
    automations: Array<{
        id: string;
        status: string;
        createdAt: string;
        automation?: { name?: string };
    }>;
    activity: Array<{
        id: string;
        lastActiveAt: string;
        referrer?: string;
        deviceType?: string;
        events: Array<{
            createdAt: string;
            type: string;
            url?: string;
        }>;
    }>;
    sendingMethods?: {
        marketing: boolean;
        transactional: boolean;
    };
    inboxConversations?: Array<{
        id: string;
        title?: string | null;
        guestEmail?: string | null;
        status: string;
        updatedAt: string;
        lastInboundMessage?: {
            id: string;
            content: string;
            createdAt: string;
        } | null;
    }>;
}

const CONTACT_STATUS_OPTIONS = [
    { value: 'UNVERIFIED', label: 'Unverified' },
    { value: 'SUBSCRIBED', label: 'Subscribed' },
    { value: 'BOUNCED', label: 'Bounced' },
    { value: 'UNSUBSCRIBED', label: 'Unsubscribed' },
    { value: 'SOFT_BOUNCED', label: 'Soft Bounced' },
    { value: 'COMPLAINT', label: 'Complaint' }
] as const;

function getContactStatusBadge(status: CustomerDetails['customer']['contactStatus'] | undefined) {
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
        default:
            return { label: 'Subscribed', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
    }
}

export function CustomerDetailsPage() {
    const navigate = useNavigate();
    const { id } = useParams();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<CustomerDetails | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'automations' | 'activity' | 'inbox'>('overview');
    const [showMergeModal, setShowMergeModal] = useState(false);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

    const fetchCustomerDetails = useCallback(async () => {
        if (!id) return;
        setIsLoading(true);
        try {
            const res = await fetch(`/api/customers/${id}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount?.id || ''
                }
            });
            if (res.ok) {
                const json = await res.json();
                setData(json);
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setIsLoading(false);
        }
    }, [id, token, currentAccount?.id]);

    useEffect(() => {
        if (id && currentAccount && token) {
            fetchCustomerDetails();
        }
    }, [id, currentAccount, token, fetchCustomerDetails]);

    useEffect(() => {
        const unsubscribe = subscribeToCrossTabEvents((event) => {
            if (event.resource !== 'customer' || event.accountId !== currentAccount?.id) {
                return;
            }

            if (!event.resourceId || event.resourceId === id) {
                void fetchCustomerDetails();
            }
        });

        return unsubscribe;
    }, [currentAccount?.id, fetchCustomerDetails, id]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void fetchCustomerDetails();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [fetchCustomerDetails]);

    const updateContactStatus = useCallback(async (status: (typeof CONTACT_STATUS_OPTIONS)[number]['value']) => {
        if (!id || !token || !currentAccount?.id || !data) return;
        setIsUpdatingStatus(true);
        try {
            const res = await fetch(`/api/customers/${id}/contact-status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: JSON.stringify({ status })
            });
            if (!res.ok) throw new Error('Failed to update status');
            const json = await res.json();
            setData({
                ...data,
                customer: {
                    ...data.customer,
                    contactStatus: json.contactStatus
                },
                sendingMethods: json.sendingMethods
            });
        } catch (err) {
            Logger.error('Failed to update contact status', { error: err });
        } finally {
            setIsUpdatingStatus(false);
        }
    }, [id, token, currentAccount?.id, data]);

    if (isLoading) return <div className="p-8 text-center text-gray-500">Loading customer profile...</div>;
    if (!data) return <div className="p-8 text-center text-red-500">Customer not found</div>;

    const { customer, orders, automations, activity, sendingMethods, inboxConversations = [] } = data;
    const statusBadge = getContactStatusBadge(customer.contactStatus);
    const currency = currentAccount?.currency || 'USD';
    const fmt = (amount: number) => formatCurrency(amount, currency);

    // Helper to get initials
    const initials = (customer.firstName?.[0] || '') + (customer.lastName?.[0] || '');

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-10">
            {/* Header */}
            <div>
                <Breadcrumbs items={[
                    { label: 'Customers', href: '/customers' },
                    { label: `${customer.firstName} ${customer.lastName}` }
                ]} />
                <div className="flex justify-between items-start">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-2xl">
                            {initials}
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">{customer.firstName} {customer.lastName}</h1>
                            <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadge.className}`}>
                                {statusBadge.label}
                            </span>
                            <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                                <span className="flex items-center gap-1"><Mail size={14} /> {customer.email}</span>
                                <span className="flex items-center gap-1"><Calendar size={14} /> Joined {formatDateSafe(customer.dateCreated, '-')}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowMergeModal(true)}
                            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2"
                        >
                            <Users size={16} />
                            Merge Duplicates
                        </button>
                        <button className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Edit Profile</button>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                    <p className="text-sm font-medium text-gray-500">Total Spent</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(Number(customer.totalSpent))}</p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                    <p className="text-sm font-medium text-gray-500">Orders</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{customer.ordersCount}</p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                    <p className="text-sm font-medium text-gray-500">Average Order</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(customer.ordersCount > 0 ? Number(customer.totalSpent) / customer.ordersCount : 0)}</p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                    <p className="text-sm font-medium text-gray-500">Last Active</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{activity[0] ? formatDateSafe(activity[0].lastActiveAt) : 'N/A'}</p>
                </div>
            </div>

            {/* Content Tabs */}
            <div className="bg-white rounded-xl shadow-xs border border-gray-200 min-h-[500px]">
                <div className="border-b border-gray-200 px-6 flex gap-6">
                    {(['overview', 'orders', 'automations', 'activity', 'inbox'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`py-4 text-sm font-medium border-b-2 transition-colors capitalize ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                <div className="p-6">
                    {activeTab === 'overview' && (
                        <div className="grid grid-cols-2 gap-8">
                            <div>
                                <h3 className="text-lg font-semibold mb-4 text-gray-900">Contact Information</h3>
                                <dl className="space-y-4">
                                    <div>
                                        <dt className="text-sm text-gray-500 mb-1">Email</dt>
                                        <dd className="font-medium">{customer.email}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-sm text-gray-500 mb-1">Phone</dt>
                                        <dd className="font-medium">{customer.rawData?.billing?.phone || 'N/A'}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-sm text-gray-500 mb-1">Contact Status</dt>
                                        <dd>
                                            <select
                                                value={customer.contactStatus || 'SUBSCRIBED'}
                                                onChange={(event) => updateContactStatus(event.target.value as (typeof CONTACT_STATUS_OPTIONS)[number]['value'])}
                                                disabled={isUpdatingStatus}
                                                className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 focus:border-blue-500 focus:outline-none"
                                            >
                                                {CONTACT_STATUS_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-sm text-gray-500 mb-1">Sending Methods</dt>
                                        <dd className="font-medium text-sm text-gray-700">
                                            Marketing: {sendingMethods?.marketing ? 'Allowed' : 'Blocked'} • Transactional: {sendingMethods?.transactional ? 'Allowed' : 'Blocked'}
                                        </dd>
                                    </div>
                                </dl>
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold mb-4 text-gray-900">Billing Address</h3>
                                <div className="text-gray-700 bg-gray-50 p-4 rounded-lg">
                                    {customer.rawData?.billing ? (
                                        <>
                                            <p>{customer.rawData.billing.address_1}</p>
                                            <p>{customer.rawData.billing.address_2}</p>
                                            <p>{customer.rawData.billing.city}, {customer.rawData.billing.state} {customer.rawData.billing.postcode}</p>
                                            <p>{customer.rawData.billing.country}</p>
                                        </>
                                    ) : (
                                        <p className="text-gray-400 italic">No address on file</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'orders' && (
                        <table className="w-full text-left">
                            <thead>
                                <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                                    <th className="pb-3">Order #</th>
                                    <th className="pb-3">Date</th>
                                    <th className="pb-3">Status</th>
                                    <th className="pb-3 text-right">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {orders.map(order => (
                                    <tr key={order.id} className="hover:bg-gray-50">
                                        <td className="py-4 font-medium text-blue-600">#{order.number}</td>
                                        <td className="py-4 text-gray-600">{formatDateSafe(order.dateCreated, '-')}</td>
                                        <td className="py-4">
                                            <span className={`px-2 py-1 rounded text-xs font-semibold uppercase ${order.status === 'completed' ? 'bg-green-100 text-green-700' :
                                                order.status === 'processing' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                                                }`}>
                                                {order.status}
                                            </span>
                                        </td>
                                        <td className="py-4 text-right font-medium">{formatCurrency(Number(order.total), order.currency || currency)}</td>
                                    </tr>
                                ))}
                                {orders.length === 0 && (
                                    <tr><td colSpan={4} className="py-8 text-center text-gray-400">No recent orders found</td></tr>
                                )}
                            </tbody>
                        </table>
                    )}

                    {activeTab === 'automations' && (
                        <div>
                            <div className="bg-blue-50 text-blue-700 p-4 rounded-lg mb-6 text-sm flex gap-2">
                                <Activity size={18} />
                                <span>Showing <strong>Marketing Automation</strong> history. Broadcast history is not currently linked to individual profiles.</span>
                            </div>
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                                        <th className="pb-3">Automation</th>
                                        <th className="pb-3">Status</th>
                                        <th className="pb-3">Enrolled At</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {automations.map(auto => (
                                        <tr key={auto.id} className="hover:bg-gray-50">
                                            <td className="py-4 font-medium flex items-center gap-2">
                                                <Zap size={16} className="text-amber-500" />
                                                {auto.automation?.name || 'Unknown Automation'}
                                            </td>
                                            <td className="py-4">
                                                <span className={`px-2 py-1 rounded text-xs font-semibold uppercase ${auto.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                                                    }`}>
                                                    {auto.status}
                                                </span>
                                            </td>
                                            <td className="py-4 text-gray-600">{formatDateTimeSafe(auto.createdAt, '-')}</td>
                                        </tr>
                                    ))}
                                    {automations.length === 0 && (
                                        <tr><td colSpan={3} className="py-8 text-center text-gray-400">No automation history</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {activeTab === 'activity' && (
                        <div>
                            <div className="space-y-6">
                                {activity.map(session => (
                                    <div key={session.id} className="flex gap-4">
                                        <div className="flex flex-col items-center">
                                            <div className="w-2 h-2 rounded-full bg-blue-400 mt-2"></div>
                                            <div className="w-0.5 h-full bg-gray-100 my-1"></div>
                                        </div>
                                        <div className="flex-1 pb-4">
                                            <div className="flex justify-between">
                                                <h4 className="font-semibold text-gray-900">Session on {formatDateSafe(session.lastActiveAt, '-')}</h4>
                                                <span className="text-xs text-gray-400">{formatTimeSafe(session.lastActiveAt, '-')}</span>
                                            </div>
                                            <p className="text-sm text-gray-500 mb-2">
                                                Referrer: {session.referrer || 'Direct'} • Device: {session.deviceType || 'Unknown'}
                                            </p>
                                            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                                                {session.events.map((event, idx: number) => (
                                                    <div key={idx} className="text-sm flex gap-2 items-start">
                                                        <span className="text-gray-400 min-w-[60px]">{toValidDate(event.createdAt)?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '--:--'}</span>
                                                        <span className={
                                                            event.type === 'purchase' ? 'text-green-600 font-medium' :
                                                                event.type === 'add_to_cart' ? 'text-blue-600 font-medium' :
                                                                    'text-gray-700'
                                                        }>
                                                            {event.type.replace(/_/g, ' ')}: {event.url}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {activity.length === 0 && (
                                    <div className="text-center text-gray-400 py-8">No live activity recorded</div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'inbox' && (
                        <div className="space-y-4">
                            {inboxConversations.length === 0 && (
                                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-gray-500">
                                    No inbox emails found for this customer yet.
                                </div>
                            )}
                            {inboxConversations.map((conversation) => (
                                <button
                                    key={conversation.id}
                                    onClick={() => navigate(`/inbox?conversationId=${conversation.id}`)}
                                    className="w-full rounded-lg border border-gray-200 p-4 text-left transition-colors hover:bg-gray-50"
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <p className="font-medium text-gray-900">{conversation.title || 'Email conversation'}</p>
                                        <span className="text-xs uppercase text-gray-500">{conversation.status}</span>
                                    </div>
                                    <p className="mt-1 text-xs text-gray-500">Updated {formatDateTimeSafe(conversation.updatedAt, '-')}</p>
                                    <p className="mt-2 text-sm text-gray-700 line-clamp-2">{conversation.lastInboundMessage?.content || 'No inbound message preview available'}</p>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Merge Modal */}
            <MergeCustomerModal
                isOpen={showMergeModal}
                onClose={() => setShowMergeModal(false)}
                customerId={id || ''}
                onMergeComplete={fetchCustomerDetails}
            />
        </div>
    );
}
