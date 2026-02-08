
import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import {
    User, Mail,
    MoreVertical,
    ChevronDown, ChevronRight,
    ShoppingBag, Package, ExternalLink
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
    messages?: { content: string }[];
}

export function ContactPanel({ conversation, onSelectConversation }: ContactPanelProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [recentOrders, setRecentOrders] = useState<Order[]>([]);
    const [previousConversations, setPreviousConversations] = useState<PreviousConversation[]>([]);
    const [isLoadingOrders, setIsLoadingOrders] = useState(false);

    const customer = conversation?.wooCustomer;


    // Fetch recent orders when customer changes or for guest emails
    useEffect(() => {
        if (customer?.wooId && token && currentAccount?.id) {
            fetchCustomerOrders(customer.wooId);
        } else if (conversation?.guestEmail && token && currentAccount?.id) {
            // For guests without a WooCustomer link, try to find orders by billing email
            fetchOrdersByEmail(conversation.guestEmail);
        } else {
            setRecentOrders([]);
            setPreviousConversations([]);
        }
    }, [customer?.wooId, conversation?.guestEmail, token, currentAccount?.id]);

    const fetchCustomerOrders = async (wooCustomerId: number) => {
        setIsLoadingOrders(true);
        try {
            const headers = {
                'Authorization': `Bearer ${token}`,
                'x-account-id': currentAccount?.id || '',
            };

            // Fetch orders and conversations in parallel
            const [ordersRes, convsRes] = await Promise.all([
                fetch(`/api/orders?customerId=${wooCustomerId}&limit=5`, { headers }),
                fetch(`/api/chat/conversations?wooCustomerId=${wooCustomerId}`, { headers })
            ]);

            if (ordersRes.ok) {
                const ordersData = await ordersRes.json();
                setRecentOrders(ordersData.orders || []);
            }

            if (convsRes.ok) {
                const convsData = await convsRes.json();
                const otherConvs = Array.isArray(convsData)
                    ? convsData.filter((c: PreviousConversation) => c.id !== conversation?.id)
                    : [];
                setPreviousConversations(otherConvs);
            }
        } catch (error) {
            Logger.error('Failed to fetch customer data:', { error: error });
        } finally {
            setIsLoadingOrders(false);
        }
    };

    // Fetch orders by billing email for guest checkouts
    const fetchOrdersByEmail = async (email: string) => {
        setIsLoadingOrders(true);
        try {
            const ordersRes = await fetch(`/api/orders?billingEmail=${encodeURIComponent(email)}&limit=5`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || '',
                },
            });
            if (ordersRes.ok) {
                const ordersData = await ordersRes.json();
                setRecentOrders(ordersData.orders || []);
            }
        } catch (error) {
            Logger.error('Failed to fetch orders by email:', { error: error });
        } finally {
            setIsLoadingOrders(false);
        }
    };

    const getOrderStatusColor = (status: string) => {
        switch (status.toLowerCase()) {
            case 'completed': return 'bg-green-100 text-green-700';
            case 'processing': return 'bg-blue-100 text-blue-700';
            case 'on-hold': return 'bg-yellow-100 text-yellow-700';
            case 'cancelled':
            case 'refunded': return 'bg-red-100 text-red-700';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    if (!conversation) return null;

    const name = customer
        ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.email || 'Anonymous'
        : conversation.guestName || conversation.guestEmail || 'Anonymous';
    const email = customer?.email || conversation.guestEmail;
    const initials = (name || 'A').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';

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
