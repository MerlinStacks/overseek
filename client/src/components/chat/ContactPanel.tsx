
import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import {
    User, Mail,
    MoreVertical,
    ChevronDown, ChevronRight,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { format } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { NotesSection } from './NotesSection';
import { OrdersSection } from './OrdersSection';
import { PreviousConversationsSection } from './PreviousConversationsSection';



interface Order {
    id: string;
    wooId: number;
    number: string;
    status: string;
    total: number;
    currency: string;
    dateCreated: string;
}

interface ContactPanelProps {
    conversation?: {
        id: string;
        status: string;
        priority?: string;
        createdAt: string;
        updatedAt: string;
        snoozedUntil?: string | null;
        wooCustomer?: {
            id: string;
            wooId: number;
            firstName?: string;
            lastName?: string;
            email?: string;
            totalSpent?: number;
            ordersCount?: number;
        };
        guestEmail?: string;
        guestName?: string;
        assignee?: {
            id: string;
            fullName?: string;
            avatarUrl?: string;
        };
        _count?: {
            messages: number;
        };
    };
    onSelectConversation?: (conversationId: string) => void;
}

interface SectionProps {
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}

function Section({ title, defaultOpen = true, children }: SectionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-gray-100">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
            >
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</span>
                {isOpen ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
            </button>
            {isOpen && (
                <div className="px-4 pb-4">
                    {children}
                </div>
            )}
        </div>
    );
}

interface PreviousConversation {
    id: string;
    status: string;
    updatedAt: string;
    channel: string;
    priority?: string;
    messages?: { content: string }[];
}

export function ContactPanel({ conversation, onSelectConversation }: ContactPanelProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [recentOrders, setRecentOrders] = useState<Order[]>([]);
    const [previousConversations, setPreviousConversations] = useState<PreviousConversation[]>([]);
    const [isLoadingOrders, setIsLoadingOrders] = useState(false);

    const customer = conversation?.wooCustomer;


    const fetchCustomerOrders = useCallback(async (wooCustomerId: number, signal?: AbortSignal) => {
        setIsLoadingOrders(true);
        try {
            const headers = {
                'Authorization': `Bearer ${token}`,
                'x-account-id': currentAccount?.id || '',
            };

            // Fetch orders and conversations in parallel
            const [ordersRes, convsRes] = await Promise.all([
                fetch(`/api/orders?customerId=${wooCustomerId}&limit=5`, { headers, signal }),
                fetch(`/api/chat/conversations?wooCustomerId=${wooCustomerId}&limit=20&sort=priority`, { headers, signal })
            ]);

            if (ordersRes.ok) {
                const ordersData: unknown = await ordersRes.json();
                setRecentOrders((ordersData as { orders?: Order[] }).orders || []);
            }

            if (convsRes.ok) {
                const convsData: unknown = await convsRes.json();
                const source = Array.isArray(convsData)
                    ? convsData
                    : ((convsData as { conversations?: PreviousConversation[] }).conversations || []);
                const otherConvs = source.filter((c: PreviousConversation) => c.id !== conversation?.id);
                setPreviousConversations(otherConvs);
            }
        } catch (error: unknown) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            Logger.error('Failed to fetch customer data:', { error });
        } finally {
            setIsLoadingOrders(false);
        }
    }, [conversation?.id, token, currentAccount?.id]);

    const fetchOrdersByEmail = useCallback(async (email: string, signal?: AbortSignal) => {
        setIsLoadingOrders(true);
        try {
            const ordersRes = await fetch(`/api/orders?billingEmail=${encodeURIComponent(email)}&limit=5`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || '',
                },
                signal,
            });
            if (ordersRes.ok) {
                const ordersData: unknown = await ordersRes.json();
                setRecentOrders((ordersData as { orders?: Order[] }).orders || []);
            }

            // Also hydrate previous conversations for guest email contacts.
            const convsRes = await fetch(`/api/chat/conversations?guestEmail=${encodeURIComponent(email)}&limit=20&sort=priority`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || '',
                },
                signal,
            });
            if (convsRes.ok) {
                const convsData: unknown = await convsRes.json();
                const source = Array.isArray(convsData)
                    ? convsData
                    : ((convsData as { conversations?: PreviousConversation[] }).conversations || []);
                const otherConvs = source.filter((c: PreviousConversation) => c.id !== conversation?.id);
                setPreviousConversations(otherConvs);
            }
        } catch (error: unknown) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            Logger.error('Failed to fetch orders by email:', { error });
        } finally {
            setIsLoadingOrders(false);
        }
    }, [conversation?.id, token, currentAccount?.id]);

    // Fetch recent orders when customer changes or for guest emails
    useEffect(() => {
        const controller = new AbortController();
        if (customer?.wooId && token && currentAccount?.id) {
            fetchCustomerOrders(customer.wooId, controller.signal);
        } else if (conversation?.guestEmail && token && currentAccount?.id) {
            fetchOrdersByEmail(conversation.guestEmail, controller.signal);
        } else {
            setRecentOrders([]);
            setPreviousConversations([]);
        }
        return () => controller.abort();
    }, [customer?.wooId, conversation?.guestEmail, token, currentAccount?.id, fetchCustomerOrders, fetchOrdersByEmail]);

    if (!conversation) return null;

    const name = customer
        ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.email || 'Anonymous'
        : conversation.guestName || conversation.guestEmail || 'Anonymous';
    const email = customer?.email || conversation.guestEmail;
    const initials = (name || 'A').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';

    const totalSpent = customer?.totalSpent || 0;
    const ordersCount = customer?.ordersCount || recentOrders.length || 0;
    const avgOrderValue = ordersCount > 0 ? totalSpent / ordersCount : 0;
    const lastOrderDate = recentOrders.length > 0 ? recentOrders[0].dateCreated : null;
    const openIssueCount = previousConversations.filter(c => c.status === 'OPEN' || c.status === 'SNOOZED').length;

    const ltvTier = totalSpent >= 5000 ? 'VIP' : totalSpent >= 1000 ? 'High Value' : totalSpent >= 250 ? 'Growing' : 'Standard';
    const likelyReason = (() => {
        const recentOrder = recentOrders[0];
        if (recentOrder?.status?.toLowerCase() === 'on-hold') return 'Order currently on hold';
        if (recentOrder?.status?.toLowerCase() === 'processing') return 'Order status follow-up';
        if (recentOrder?.status?.toLowerCase() === 'refunded') return 'Refund clarification';

        const recentText = previousConversations[0]?.messages?.[0]?.content?.toLowerCase() || '';
        if (recentText.includes('refund')) return 'Refund-related question';
        if (recentText.includes('shipping') || recentText.includes('delivery')) return 'Shipping update request';
        if (recentText.includes('cancel')) return 'Cancellation request';
        return 'General support follow-up';
    })();

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'OPEN': return 'bg-green-100 text-green-700';
            case 'CLOSED': return 'bg-gray-100 text-gray-700';
            case 'SNOOZED': return 'bg-yellow-100 text-yellow-700';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    const getPriorityColor = (priority?: string) => {
        switch (priority) {
            case 'HIGH': return 'text-red-600';
            case 'MEDIUM': return 'text-yellow-600';
            case 'LOW': return 'text-green-600';
            default: return 'text-gray-500';
        }
    };

    return (
        <div className="w-80 border-l border-gray-200 bg-white hidden lg:flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <span className="text-sm font-medium text-gray-700">Contact</span>
                <button className="p-1 rounded-sm hover:bg-gray-100 text-gray-400">
                    <MoreVertical size={16} />
                </button>
            </div>

            {/* Contact Card */}
            <div className="p-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white font-medium">
                        {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">{name}</h3>
                        {email && (
                            <a href={`mailto:${email}`} className="text-sm text-blue-600 hover:underline flex items-center gap-1 truncate">
                                <Mail size={12} />
                                {email}
                            </a>
                        )}
                    </div>
                </div>

                {/* Quick Stats for WooCustomer */}
                {customer && (
                    <div className="grid grid-cols-3 gap-2 mt-4">
                        <div className="bg-gray-50 rounded-lg p-2 text-center">
                            <div className="text-lg font-semibold text-gray-900">{customer.ordersCount || 0}</div>
                            <div className="text-xs text-gray-500">Orders</div>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2 text-center">
                            <div className="text-lg font-semibold text-gray-900">
                                ${(customer.totalSpent || 0).toLocaleString()}
                            </div>
                            <div className="text-xs text-gray-500">Spent</div>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2 text-center">
                            <div className="text-lg font-semibold text-gray-900">{previousConversations.length + 1}</div>
                            <div className="text-xs text-gray-500">Convos</div>
                        </div>
                    </div>
                )}

                {/* Not a customer indicator */}
                {!customer && (
                    <div className="mt-3 text-xs text-gray-500 flex items-center gap-1">
                        <User size={12} />
                        Not linked to a customer
                    </div>
                )}
            </div>


            {/* Scrollable Sections */}
            <div className="flex-1 overflow-y-auto">

                {/* Order History - show for linked customers OR guests with orders */}
                {(customer || (conversation?.guestEmail && recentOrders.length > 0) || isLoadingOrders) && (
                    <Section title={customer ? "Recent Orders" : "Orders by Email"} defaultOpen={true}>
                        <OrdersSection
                            orders={recentOrders}
                            isLoading={isLoadingOrders}
                            customerId={customer?.id}
                            ordersCount={customer?.ordersCount}
                        />
                    </Section>
                )}


                {/* Conversation Info */}
                <Section title="Conversation Information" defaultOpen={true}>
                    <div className="space-y-3 text-sm">
                        <div className="flex justify-between">
                            <span className="text-gray-500">Status</span>
                            <span className={cn("px-2 py-0.5 rounded-sm text-xs font-medium", getStatusColor(conversation.status))}>
                                {conversation.status}
                            </span>
                        </div>
                        {conversation.status === 'SNOOZED' && conversation.snoozedUntil && (
                            <div className="flex justify-between">
                                <span className="text-gray-500">Snooze until</span>
                                <span className="text-yellow-600 text-xs">
                                    {format(new Date(conversation.snoozedUntil), 'MMM d, h:mm a')}
                                </span>
                            </div>
                        )}
                        <div className="flex justify-between">
                            <span className="text-gray-500">Priority</span>
                            <span className={cn("font-medium", getPriorityColor(conversation.priority))}>
                                {conversation.priority || 'Normal'}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Assignee</span>
                            <span className="text-gray-900">
                                {conversation.assignee?.fullName || 'Unassigned'}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Messages</span>
                            <span className="text-gray-900">{conversation._count?.messages || 0}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Created</span>
                            <span className="text-gray-900 text-xs">
                                {format(new Date(conversation.createdAt), 'MMM d, yyyy')}
                            </span>
                        </div>
                    </div>
                </Section>

                {/* Customer Insights */}
                <Section title="Customer Insights" defaultOpen={true}>
                    <div className="space-y-3 text-sm">
                        <div className="flex justify-between">
                            <span className="text-gray-500">LTV Tier</span>
                            <span className="font-medium text-gray-900">{ltvTier}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Avg Order Value</span>
                            <span className="text-gray-900">${avgOrderValue.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Open Issues</span>
                            <span className={cn("font-medium", openIssueCount > 0 ? "text-amber-700" : "text-gray-900")}>
                                {openIssueCount}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Last Order</span>
                            <span className="text-gray-900 text-xs">
                                {lastOrderDate ? format(new Date(lastOrderDate), 'MMM d, yyyy') : 'No orders'}
                            </span>
                        </div>
                        <div className="pt-2 border-t border-gray-100">
                            <div className="text-gray-500 text-xs mb-1">Likely reason for contact</div>
                            <div className="text-gray-900 font-medium">{likelyReason}</div>
                        </div>
                    </div>
                </Section>

                {/* Auto-reopen notice */}
                <div className="px-4 py-3 bg-blue-50 text-xs text-blue-700">
                    <strong>Note:</strong> Resolved conversations will automatically reopen when the customer replies.
                </div>

                {/* Contact Attributes for WooCustomer */}
                {customer && (
                    <Section title="Contact Attributes" defaultOpen={false}>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Customer ID</span>
                                <span className="text-gray-900 font-mono text-xs">{customer.id?.slice(0, 8) || 'N/A'}...</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">WooCommerce ID</span>
                                <span className="text-gray-900 font-mono text-xs">{customer.wooId}</span>
                            </div>
                        </div>
                    </Section>
                )}

                {/* Contact Notes */}
                <Section title="Notes" defaultOpen={true}>
                    <NotesSection conversationId={conversation.id} />
                </Section>

                {/* Previous Conversations */}
                <Section title="Previous Conversations" defaultOpen={false}>
                    <PreviousConversationsSection
                        conversations={previousConversations}
                        onSelectConversation={onSelectConversation}
                    />
                </Section>
            </div>
        </div>
    );
}
