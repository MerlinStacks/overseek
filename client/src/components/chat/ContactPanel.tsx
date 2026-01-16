
import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import {
    User, Mail,
    MoreVertical,
    ChevronDown, ChevronRight,
    ShoppingBag, Package, MessageSquare, ExternalLink, Trash2, Send
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { format } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface Note {
    id: string;
    content: string;
    createdAt: string;
    createdBy: { id: string; fullName?: string; avatarUrl?: string };
}

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
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();
    const [recentOrders, setRecentOrders] = useState<Order[]>([]);
    const [previousConversations, setPreviousConversations] = useState<PreviousConversation[]>([]);
    const [isLoadingOrders, setIsLoadingOrders] = useState(false);
    const [notes, setNotes] = useState<Note[]>([]);
    const [newNote, setNewNote] = useState('');
    const [isAddingNote, setIsAddingNote] = useState(false);

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

    // Fetch notes when conversation changes
    useEffect(() => {
        if (conversation?.id && token) {
            fetchNotes();
        }
    }, [conversation?.id, token]);

    const fetchNotes = async () => {
        if (!conversation?.id) return;
        try {
            const res = await fetch(`/api/chat/conversations/${conversation.id}/notes`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            if (res.ok) setNotes(await res.json());
        } catch (e) {
            Logger.error('Failed to fetch notes:', { error: e });
        }
    };

    const addNote = async () => {
        if (!newNote.trim() || !conversation?.id) return;
        setIsAddingNote(true);
        try {
            const res = await fetch(`/api/chat/conversations/${conversation.id}/notes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify({ content: newNote })
            });
            if (res.ok) {
                const note = await res.json();
                setNotes([note, ...notes]);
                setNewNote('');
            }
        } catch (e) {
            Logger.error('Failed to add note:', { error: e });
        } finally {
            setIsAddingNote(false);
        }
    };

    const deleteNote = async (noteId: string) => {
        if (!confirm('Delete this note?')) return;
        try {
            await fetch(`/api/chat/conversations/${conversation?.id}/notes/${noteId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });
            setNotes(notes.filter(n => n.id !== noteId));
        } catch (e) {
            Logger.error('Failed to delete note:', { error: e });
        }
    };

    const fetchCustomerOrders = async (wooCustomerId: number) => {
        setIsLoadingOrders(true);
        try {
            // Fetch recent orders for this customer
            const ordersRes = await fetch(`/api/orders?customerId=${wooCustomerId}&limit=5`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || '',
                },
            });
            if (ordersRes.ok) {
                const ordersData = await ordersRes.json();
                setRecentOrders(ordersData.orders || []);
            }

            // Fetch conversation list for this customer
            const convsRes = await fetch(`/api/chat/conversations?wooCustomerId=${wooCustomerId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || '',
                },
            });
            if (convsRes.ok) {
                const convsData = await convsRes.json();
                // Filter out the current conversation
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
                        {isLoadingOrders ? (
                            <div className="text-sm text-gray-500 italic">Loading orders...</div>
                        ) : recentOrders.length === 0 ? (
                            <div className="text-sm text-gray-500 italic">No orders found.</div>
                        ) : (
                            <div className="space-y-2">
                                {recentOrders.map((order) => (
                                    <a
                                        key={order.id}
                                        href={`/orders/${order.id}`}
                                        className="block p-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Package size={14} className="text-gray-400" />
                                                <span className="text-sm font-medium text-gray-900">#{order.number}</span>
                                            </div>
                                            <span className={cn(
                                                "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase",
                                                getOrderStatusColor(order.status)
                                            )}>
                                                {order.status}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="text-xs text-gray-500">
                                                {format(new Date(order.dateCreated), 'MMM d, yyyy')}
                                            </span>
                                            <span className="text-xs font-medium text-gray-700">
                                                {order.currency} {Number(order.total).toFixed(2)}
                                            </span>
                                        </div>
                                    </a>
                                ))}
                                {customer?.ordersCount && customer.ordersCount > 5 && (
                                    <a
                                        href={`/customers/${customer.id}`}
                                        className="flex items-center justify-center gap-1 text-xs text-blue-600 hover:underline mt-2"
                                    >
                                        View all {customer.ordersCount} orders
                                        <ExternalLink size={10} />
                                    </a>
                                )}
                            </div>
                        )}
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
                                <span className="text-gray-900 font-mono text-xs">{customer.id.slice(0, 8)}...</span>
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
                    {/* Add note form */}
                    <div className="flex gap-2 mb-3">
                        <input
                            type="text"
                            placeholder="Add a note..."
                            value={newNote}
                            onChange={(e) => setNewNote(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addNote()}
                            className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                        <button
                            onClick={addNote}
                            disabled={!newNote.trim() || isAddingNote}
                            className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Send size={14} />
                        </button>
                    </div>

                    {/* Notes list */}
                    {notes.length === 0 ? (
                        <div className="text-sm text-gray-500 italic">No notes yet.</div>
                    ) : (
                        <div className="space-y-2">
                            {notes.map((note) => (
                                <div key={note.id} className="bg-yellow-50 border border-yellow-100 rounded-lg p-2 group">
                                    <p className="text-sm text-gray-800">{note.content}</p>
                                    <div className="flex items-center justify-between mt-1">
                                        <span className="text-[10px] text-gray-500">
                                            {note.createdBy?.fullName || 'Agent'} · {format(new Date(note.createdAt), 'MMM d, h:mm a')}
                                        </span>
                                        {note.createdBy?.id === user?.id && (
                                            <button
                                                onClick={() => deleteNote(note.id)}
                                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 transition-opacity"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Section>

                {/* Previous Conversations */}
                <Section title="Previous Conversations" defaultOpen={false}>
                    {previousConversations.length > 0 ? (
                        <div className="space-y-2">
                            {previousConversations.slice(0, 5).map((conv) => {
                                const preview = conv.messages?.[0]?.content?.replace(/<[^>]*>/g, '').slice(0, 60) || 'No messages';
                                return (
                                    <button
                                        key={conv.id}
                                        onClick={() => onSelectConversation?.(conv.id)}
                                        className="w-full text-left p-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className={cn(
                                                "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase",
                                                conv.status === 'OPEN' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                            )}>
                                                {conv.status}
                                            </span>
                                            <span className="text-[10px] text-gray-400">
                                                {format(new Date(conv.updatedAt), 'MMM d')}
                                            </span>
                                        </div>
                                        <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                                            {preview}
                                        </p>
                                    </button>
                                );
                            })}
                            {previousConversations.length > 5 && (
                                <div className="text-xs text-gray-500 text-center pt-1">
                                    +{previousConversations.length - 5} more
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-sm text-gray-500 italic">
                            No previous conversations found.
                        </div>
                    )}
                </Section>
            </div>
        </div>
    );
}
