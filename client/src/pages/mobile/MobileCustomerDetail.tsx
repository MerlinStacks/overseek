import { useState, useEffect, useCallback, useRef } from 'react';
import { Logger } from '../../utils/logger';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, MapPin, ShoppingBag, Calendar, RefreshCw, Package, ChevronRight, DollarSign, Send } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { formatCurrency, formatDate } from '../../utils/format';
import { getStatusColor } from '../../utils/orderStatus';
import { subscribeToCrossTabEvents } from '../../utils/productCrossTabEvents';
import { emailMessageToPreview } from '../../utils/emailParser';
import { EditCustomerProfileModal, type CustomerProfileValues } from '../../components/customers/EditCustomerProfileModal';

interface OrderApiResponse {
    id: string;
    rawData?: {
        number?: string;
        status?: string;
        total?: string | number;
        date_created?: string;
    };
    wooId?: string;
    status?: string;
    total?: string | number;
    dateCreated?: string;
}

interface CustomerOrder {
    id: string;
    number: string;
    status: string;
    total: number;
    dateCreated: string;
}

type ContactStatus = 'UNVERIFIED' | 'SUBSCRIBED' | 'BOUNCED' | 'UNSUBSCRIBED' | 'SOFT_BOUNCED' | 'COMPLAINT';

interface BillingAddress {
    phone?: string;
    company?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
}

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
            billing?: BillingAddress;
        };
        billingAddress?: BillingAddress;
        company?: string;
        abn?: string;
        contactStatus?: ContactStatus;
    };
    orders: CustomerOrder[];
    automations: Array<{
        id: string;
        status: string;
        createdAt: string;
        automation?: { name?: string };
        emailLogs?: Array<{
            id: string;
            to: string;
            subject: string;
            status: string;
            errorMessage?: string | null;
            firstOpenedAt?: string | null;
            openCount: number;
            canResend?: boolean;
            createdAt: string;
        }>;
    }>;
    activity: { id: string; type: string; message: string; timestamp: string }[];
    sendingMethods?: { marketing: boolean; transactional: boolean };
    inboxConversations?: Array<{
        id: string;
        title?: string | null;
        status: string;
        updatedAt: string;
        lastInboundMessage?: { id: string; content: string; createdAt: string } | null;
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

function getContactStatusBadge(status: CustomerDetails['customer']['contactStatus']) {
    switch (status) {
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
            return { label: 'Unknown', className: 'bg-slate-100 text-slate-700 border-slate-300' };
    }
}

/**
 * MobileCustomerDetail - Mobile-optimized customer profile page
 * Shows customer info, stats, and recent orders
 */
export function MobileCustomerDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const [data, setData] = useState<CustomerDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [notFound, setNotFound] = useState(false);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [statusFeedback, setStatusFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileError, setProfileError] = useState<string | null>(null);
    const [resendingEmailId, setResendingEmailId] = useState<string | null>(null);
    const [resendFeedback, setResendFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const customerRequestRef = useRef<AbortController | null>(null);

    const fetchCustomer = useCallback(async () => {
        customerRequestRef.current?.abort();

        if (!accountId || !token || !id) {
            setData(null);
            setNotFound(false);
            setLoadError('Customer details are unavailable. Please try again.');
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        customerRequestRef.current = controller;

        try {
            setLoading(true);
            setLoadError(null);
            setNotFound(false);
            setData(null);
            const res = await fetch(`/api/customers/${id}`, {
                signal: controller.signal,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': accountId
                }
            });
            if (controller.signal.aborted || customerRequestRef.current !== controller) return;

            if (res.status === 404) {
                setData(null);
                setNotFound(true);
                return;
            }

            if (res.ok) {
                const json = await res.json();
                if (controller.signal.aborted || customerRequestRef.current !== controller) return;
                // Map API response to our expected shape
                // API returns: { customer, orders (raw WooOrders), automations, activity }
                const mappedData: CustomerDetails = {
                    customer: {
                        id: json.customer?.id || id,
                        firstName: json.customer?.firstName || '',
                        lastName: json.customer?.lastName || '',
                        email: json.customer?.email || '',
                        totalSpent: Number(json.customer?.totalSpent) || 0,
                        ordersCount: json.customer?.ordersCount || 0,
                        dateCreated: json.customer?.dateCreated || json.customer?.createdAt || '',
                        rawData: json.customer?.rawData,
                        billingAddress: json.customer?.billingAddress,
                        company: json.customer?.company,
                        abn: json.customer?.abn,
                        contactStatus: json.customer?.contactStatus
                    },
                    orders: (json.orders || []).map((order: OrderApiResponse) => ({
                        id: order.id,
                        number: order.rawData?.number || order.wooId || order.id,
                        status: order.rawData?.status || order.status || 'unknown',
                        total: Number(order.rawData?.total || order.total) || 0,
                        dateCreated: order.rawData?.date_created || order.dateCreated || ''
                    })),
                    automations: json.automations || [],
                    activity: json.activity || [],
                    sendingMethods: json.sendingMethods,
                    inboxConversations: json.inboxConversations || []
                };
                setData(mappedData);
                setLoadError(null);
                setNotFound(false);
            } else {
                throw new Error(`Failed to fetch customer: ${res.status}`);
            }
        } catch (error) {
            if (controller.signal.aborted) return;
            setData(null);
            setNotFound(false);
            setLoadError('Could not load customer. Pull down or tap retry to refresh.');
            Logger.error('[MobileCustomerDetail] Error:', { error: error });
        } finally {
            if (customerRequestRef.current === controller && !controller.signal.aborted) {
                setLoading(false);
            }
        }
    }, [accountId, id, token]);

    const updateContactStatus = useCallback(async (status: (typeof CONTACT_STATUS_OPTIONS)[number]['value']) => {
        if (!id || !token || !currentAccount?.id || !data?.customer.contactStatus) return;
        const previousStatus = data.customer.contactStatus;
        const previousSendingMethods = data.sendingMethods;

        setIsUpdatingStatus(true);
        setStatusFeedback(null);
        setData((current) => current ? {
            ...current,
            customer: { ...current.customer, contactStatus: status }
        } : current);

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
            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload.error || 'Failed to update status');
            }
            const json = await res.json();
            setData((current) => current ? {
                ...current,
                customer: {
                    ...current.customer,
                    contactStatus: json.contactStatus || status
                },
                sendingMethods: json.sendingMethods
            } : current);
            setStatusFeedback({ type: 'success', message: 'Contact status updated.' });
        } catch (error) {
            Logger.error('[MobileCustomerDetail] Failed to update status', { error });
            setData((current) => current ? {
                ...current,
                customer: { ...current.customer, contactStatus: previousStatus },
                sendingMethods: previousSendingMethods
            } : current);
            setStatusFeedback({ type: 'error', message: 'Could not update contact status. Your previous status was restored.' });
        } finally {
            setIsUpdatingStatus(false);
        }
    }, [id, token, currentAccount?.id, data]);

    const resendAutomationEmail = useCallback(async (emailLogId: string) => {
        if (!currentAccount || !token) return;
        setResendingEmailId(emailLogId);
        setResendFeedback(null);
        try {
            const res = await fetch(`/api/email/logs/${emailLogId}/resend`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload.error || 'Failed to resend email');
            }

            setResendFeedback({ type: 'success', message: 'Email resent.' });
            await fetchCustomer();
        } catch (error) {
            Logger.error('[MobileCustomerDetail] Failed to resend automation email', { error, emailLogId });
            setResendFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Failed to resend email.' });
        } finally {
            setResendingEmailId(null);
        }
    }, [currentAccount, fetchCustomer, token]);

    const saveProfile = useCallback(async (profile: CustomerProfileValues) => {
        if (!id || !token || !accountId) return;
        setIsSavingProfile(true);
        setProfileError(null);
        try {
            const response = await fetch(`/api/customers/${id}/profile`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': accountId
                },
                body: JSON.stringify(profile)
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const fieldMessage = Object.values(payload.details?.fieldErrors || {}).flat().find((message): message is string => typeof message === 'string');
                throw new Error(fieldMessage || payload.error || 'Failed to save profile');
            }
            setShowEditModal(false);
            await fetchCustomer();
        } catch (error) {
            Logger.error('[MobileCustomerDetail] Failed to update profile', { error });
            setProfileError(error instanceof Error ? error.message : 'Failed to save profile');
        } finally {
            setIsSavingProfile(false);
        }
    }, [accountId, fetchCustomer, id, token]);

    useEffect(() => {
        if (!statusFeedback) return;
        const timer = window.setTimeout(() => setStatusFeedback(null), 4000);
        return () => window.clearTimeout(timer);
    }, [statusFeedback]);

    useEffect(() => {
        if (!resendFeedback) return;
        const timer = window.setTimeout(() => setResendFeedback(null), 4000);
        return () => window.clearTimeout(timer);
    }, [resendFeedback]);

    useEffect(() => {
        void fetchCustomer();
        const handleRefresh = () => {
            void fetchCustomer();
        };
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => {
            window.removeEventListener('mobile-refresh', handleRefresh);
            customerRequestRef.current?.abort();
        };
    }, [fetchCustomer]);

    useEffect(() => {
        const unsubscribe = subscribeToCrossTabEvents((event) => {
            if (event.resource !== 'customer' || event.accountId !== currentAccount?.id) {
                return;
            }

            if (!event.resourceId || event.resourceId === id) {
                void fetchCustomer();
            }
        });

        return unsubscribe;
    }, [currentAccount?.id, fetchCustomer, id]);

    // Currency formatting helper using centralized utility
    const formatAccountCurrency = (amount: number) =>
        formatCurrency(amount, currentAccount?.currency || 'USD');

    if (loading) {
        return (
            <div className="space-y-4 animate-pulse" role="status" aria-label="Loading customer details">
                <span className="sr-only">Loading customer details</span>
                <div className="h-8 bg-gray-200 rounded w-1/3" />
                <div className="h-32 bg-gray-200 rounded-xl" />
                <div className="grid grid-cols-2 gap-3">
                    <div className="h-24 bg-gray-200 rounded-xl" />
                    <div className="h-24 bg-gray-200 rounded-xl" />
                </div>
                {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
            </div>
        );
    }

    if (!data) {
        if (loadError) {
            return (
                <div className="rounded-[1.5rem] border border-rose-400/20 bg-rose-500/10 p-5 text-center text-rose-100" role="alert">
                    <p className="mb-4 text-sm font-medium">{loadError}</p>
                    <button
                        onClick={() => void fetchCustomer()}
                        className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15 active:scale-[0.98]"
                    >
                        Retry
                    </button>
                </div>
            );
        }

        if (notFound) return (
            <div className="text-center py-16">
                <ShoppingBag aria-hidden="true" className="mx-auto mb-4 text-slate-400" size={48} />
                <p className="font-medium text-white">Customer not found</p>
                <button onClick={() => navigate('/m/customers')} className="mt-4 rounded-lg px-3 py-2 font-semibold text-indigo-300 active:bg-white/10">
                    Back to Customers
                </button>
            </div>
        );

        return null;
    }

    const { customer, orders, automations, sendingMethods, inboxConversations = [] } = data;
    const statusBadge = getContactStatusBadge(customer.contactStatus);
    const billing = customer.billingAddress || customer.rawData?.billing || {};
    const company = customer.company || billing.company;
    const addressLines = [
        billing.address_1,
        billing.address_2,
        [billing.city, billing.state, billing.postcode].filter(Boolean).join(' '),
        billing.country
    ].filter(Boolean);
    const fullName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unknown';
    const initials = (customer.firstName?.[0] || '') + (customer.lastName?.[0] || '');
    const avgOrder = customer.ordersCount > 0 ? customer.totalSpent / customer.ordersCount : 0;
    const profileValues: CustomerProfileValues = {
        firstName: customer.firstName || '', lastName: customer.lastName || '', email: customer.email || '',
        phone: billing.phone || '', company: company || '', abn: customer.abn || '',
        address1: billing.address_1 || '', address2: billing.address_2 || '', city: billing.city || '',
        state: billing.state || '', postcode: billing.postcode || '', country: billing.country || ''
    };

    return (
        <div className="space-y-4 pb-8">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button onClick={() => navigate('/m/customers')} className="-ml-2 flex min-h-11 min-w-11 items-center justify-center rounded-lg active:bg-white/10" aria-label="Back to customers">
                    <ArrowLeft aria-hidden="true" size={24} className="text-slate-200" />
                </button>
                <div className="min-w-0 flex-1">
                    <h1 className="break-words text-xl font-bold text-white">{fullName}</h1>
                    <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusBadge.className}`}>
                        {statusBadge.label}
                    </span>
                    <p className="text-sm text-slate-300">Customer Profile</p>
                </div>
                <button onClick={() => void fetchCustomer()} className="flex min-h-11 min-w-11 items-center justify-center rounded-full active:bg-white/10" aria-label="Refresh customer details">
                    <RefreshCw aria-hidden="true" size={20} className="text-slate-200" />
                </button>
            </div>

            {/* Profile Card */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <div className="flex items-center gap-4 mb-4">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl">
                        {initials || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                        <h2 className="text-lg font-semibold text-gray-900">{fullName}</h2>
                        <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                            <Calendar aria-hidden="true" size={14} />
                            <span>Customer since {formatDate(customer.dateCreated)}</span>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => { setProfileError(null); setShowEditModal(true); }}
                        className="min-h-11 rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700 active:bg-indigo-50"
                    >
                        Edit
                    </button>
                </div>

                {/* Contact Info */}
                <div className="space-y-2 pt-3 border-t border-gray-100">
                    <div className="flex items-center gap-3 text-sm">
                        <Mail aria-hidden="true" size={16} className="shrink-0 text-gray-500" />
                        {customer.email ? <a href={`mailto:${customer.email}`} className="break-all font-medium text-indigo-700">{customer.email}</a> : <span className="text-gray-600">Email unknown</span>}
                    </div>
                    {billing.phone && (
                        <div className="flex items-center gap-3 text-sm">
                            <Phone aria-hidden="true" size={16} className="shrink-0 text-gray-500" />
                            <a href={`tel:${billing.phone}`} className="font-medium text-indigo-700">
                                {billing.phone}
                            </a>
                        </div>
                    )}
                    {(company || customer.abn || addressLines.length > 0) && (
                        <div className="flex items-start gap-3 text-sm">
                            <MapPin aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-gray-500" />
                            <div className="min-w-0 space-y-1 text-gray-700">
                                {company && <p className="break-words font-semibold">{company}</p>}
                                {customer.abn && <p><span className="font-medium">ABN:</span> {customer.abn}</p>}
                                {addressLines.map((line, index) => <p key={`${line}-${index}`} className="break-words">{line}</p>)}
                            </div>
                        </div>
                    )}
                    <div className="pt-2">
                        <label htmlFor="mobile-contact-status" className="mb-1 block text-xs font-medium text-gray-600">Contact Status</label>
                        <select
                            id="mobile-contact-status"
                            value={customer.contactStatus || ''}
                            onChange={(event) => updateContactStatus(event.target.value as (typeof CONTACT_STATUS_OPTIONS)[number]['value'])}
                            disabled={isUpdatingStatus || !customer.contactStatus}
                            className="min-h-11 w-full rounded-lg border border-gray-400 bg-white px-3 py-2 text-sm font-medium text-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-600"
                        >
                            {!customer.contactStatus && <option value="">Unknown</option>}
                            {CONTACT_STATUS_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        {statusFeedback && (
                            <p role={statusFeedback.type === 'error' ? 'alert' : 'status'} className={`mt-2 rounded-md px-2.5 py-2 text-xs font-medium ${statusFeedback.type === 'success' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                {statusFeedback.message}
                            </p>
                        )}
                        {!customer.contactStatus && <p className="mt-2 text-xs text-gray-600">Status changes are unavailable because no contact status was returned.</p>}
                        <p className="mt-2 text-xs text-gray-600">
                            Marketing: {sendingMethods ? (sendingMethods.marketing ? 'Allowed' : 'Blocked') : 'Unknown'} / Transactional: {sendingMethods ? (sendingMethods.transactional ? 'Allowed' : 'Blocked') : 'Unknown'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-3">
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-3 border border-green-100">
                    <div className="flex items-center gap-1 text-green-600 mb-1">
                        <DollarSign size={14} />
                        <span className="text-xs font-medium">Total</span>
                    </div>
                    <p className="break-words text-lg font-bold text-gray-900">{formatAccountCurrency(customer.totalSpent)}</p>
                </div>
                <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-3 border border-indigo-100">
                    <div className="flex items-center gap-1 text-indigo-600 mb-1">
                        <Package size={14} />
                        <span className="text-xs font-medium">Orders</span>
                    </div>
                    <p className="text-lg font-bold text-gray-900">{customer.ordersCount}</p>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-3 border border-amber-100">
                    <div className="flex items-center gap-1 text-amber-600 mb-1">
                        <ShoppingBag size={14} />
                        <span className="text-xs font-medium">AOV</span>
                    </div>
                    <p className="text-lg font-bold text-gray-900">{formatAccountCurrency(avgOrder)}</p>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <h2 className="font-semibold text-gray-900 p-4 border-b border-gray-100">Inbox Emails ({inboxConversations.length})</h2>
                <div className="divide-y divide-gray-100">
                    {inboxConversations.length > 0 ? (
                        inboxConversations.map((conversation) => (
                            <button
                                key={conversation.id}
                                onClick={() => navigate(`/m/inbox/${conversation.id}`)}
                                className="w-full p-4 text-left active:bg-gray-50"
                            >
                                <p className="font-medium text-gray-900 truncate">{conversation.title || 'Email conversation'}</p>
                                <p className="mt-1 text-xs text-gray-500">{formatDate(conversation.updatedAt)} • {conversation.status}</p>
                                <p className="mt-2 text-sm text-gray-700 line-clamp-2">{conversation.lastInboundMessage?.content ? emailMessageToPreview(conversation.lastInboundMessage.content) : 'No inbound message preview available'}</p>
                            </button>
                        ))
                    ) : (
                        <div className="p-6 text-center text-gray-400 text-sm">No inbox emails found for this customer yet.</div>
                    )}
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <h2 className="font-semibold text-gray-900 p-4 border-b border-gray-100">Automation Emails</h2>
                {resendFeedback && (
                    <div className={`mx-4 mt-4 rounded-lg px-3 py-2 text-sm ${resendFeedback.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                        {resendFeedback.message}
                    </div>
                )}
                <div className="divide-y divide-gray-100">
                    {automations.length > 0 ? (
                        automations.map((automation) => (
                            <div key={automation.id} className="p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-medium text-gray-900 truncate">{automation.automation?.name || 'Unknown Automation'}</p>
                                        <p className="mt-1 text-xs text-gray-500">Enrolled {formatDate(automation.createdAt)} • {automation.status}</p>
                                    </div>
                                    <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                                        {automation.emailLogs?.length || 0} sent
                                    </span>
                                </div>
                                <div className="mt-3 space-y-2">
                                    {automation.emailLogs && automation.emailLogs.length > 0 ? (
                                        automation.emailLogs.map((email) => (
                                            <div key={email.id} className="rounded-lg bg-gray-50 p-3">
                                                <div className="flex items-start gap-2">
                                                    <Mail size={14} className="mt-0.5 shrink-0 text-gray-400" />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-sm font-medium text-gray-900 line-clamp-2">{email.subject || '(No subject)'}</p>
                                                        <p className="mt-1 text-xs text-gray-500">{formatDate(email.createdAt)} • {email.status} • Opens: {email.openCount || 0}</p>
                                                        <button
                                                            type="button"
                                                            onClick={() => resendAutomationEmail(email.id)}
                                                            disabled={!email.canResend || resendingEmailId === email.id}
                                                            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-60"
                                                        >
                                                            <Send size={12} />
                                                            {resendingEmailId === email.id ? 'Resending...' : 'Resend'}
                                                        </button>
                                                        {email.errorMessage && <p className="mt-1 text-xs text-red-600 line-clamp-2">{email.errorMessage}</p>}
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500">No email sends recorded for this enrollment.</p>
                                    )}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="p-6 text-center text-gray-400 text-sm">No automation history</div>
                    )}
                </div>
            </div>

            {/* Recent Orders */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <h2 className="font-semibold text-gray-900 p-4 border-b border-gray-100">
                    Recent Orders ({orders.length})
                </h2>
                <div className="divide-y divide-gray-100">
                    {orders.length > 0 ? (
                        orders.slice(0, 10).map((order) => (
                            <button
                                key={order.id}
                                onClick={() => navigate(`/m/orders/${order.id}`)}
                                className="w-full p-4 flex items-center gap-3 text-left active:bg-gray-50"
                            >
                                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                                    <Package size={18} className="text-gray-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900">Order #{order.number}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium uppercase ${getStatusColor(order.status)}`}>
                                            {order.status}
                                        </span>
                                        <span className="text-xs text-gray-500">{formatDate(order.dateCreated)}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-gray-900">{formatAccountCurrency(order.total)}</span>
                                    <ChevronRight size={18} className="text-gray-400" />
                                </div>
                            </button>
                        ))
                    ) : (
                        <div className="p-8 text-center text-gray-400">
                            No orders found
                        </div>
                    )}
                </div>
            </div>
            <EditCustomerProfileModal
                isOpen={showEditModal}
                initialValues={profileValues}
                isSaving={isSavingProfile}
                error={profileError}
                onClose={() => setShowEditModal(false)}
                onSave={saveProfile}
            />
        </div>
    );
}
