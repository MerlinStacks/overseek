/**
 * EventSelectorModal - Categorized trigger/event selector modal.
 * Left sidebar with categories, right content with event buttons.
 */
import React, { useState, useMemo } from 'react';
import { X, Search, ShoppingCart, Users, CreditCard, Mail, Webhook, Tag, Eye, Star, UserPlus } from 'lucide-react';

// Event category definitions
const EVENT_CATEGORIES = [
    { id: 'woocommerce', label: 'WooCommerce', icon: ShoppingCart },
    { id: 'customer', label: 'Customer', icon: Users },
    { id: 'subscription', label: 'Subscription', icon: CreditCard },
    { id: 'email', label: 'Email Engagement', icon: Mail },
    { id: 'automation', label: 'Automation', icon: Webhook },
] as const;

// Events organized by category and subcategory
const EVENTS_BY_CATEGORY: Record<string, { subcategory?: string; events: EventItem[] }[]> = {
    woocommerce: [
        {
            subcategory: 'Orders',
            events: [
                { id: 'ORDER_CREATED', label: 'Order Created', icon: '🛒' },
                { id: 'ORDER_COMPLETED', label: 'Order Completed', icon: '✅' },
                { id: 'ORDER_STATUS_CHANGED', label: 'Order Status Changed', icon: '🔄' },
            ]
        },
        {
            subcategory: 'Cart',
            events: [
                { id: 'ABANDONED_CART', label: 'Cart Abandoned', icon: '🛒' },
                { id: 'CART_VIEWED', label: 'Cart Viewed', icon: '👁️' },
            ]
        },
        {
            subcategory: 'Reviews',
            events: [
                { id: 'REVIEW_LEFT', label: 'Review Left', icon: '⭐' },
            ]
        },
    ],
    customer: [
        {
            subcategory: 'Lists',
            events: [
                { id: 'ADDED_TO_LIST', label: 'Added to List', icon: '📋' },
                { id: 'REMOVED_FROM_LIST', label: 'Removed from List', icon: '📋' },
            ]
        },
        {
            subcategory: 'Contact',
            events: [
                { id: 'CUSTOMER_SIGNUP', label: 'Customer Signup', icon: '👤' },
                { id: 'TAG_ADDED', label: 'Tag is Added', icon: '🏷️' },
                { id: 'TAG_REMOVED', label: 'Tag is Removed', icon: '🏷️' },
                { id: 'CONTACT_BOUNCED', label: 'Contact Bounced', icon: '⚠️' },
                { id: 'BIRTHDAY_REMINDER', label: 'Birthday Reminder', icon: '🎂' },
                { id: 'MANUAL', label: 'Manual Entry', icon: '✋' },
            ]
        },
    ],
    subscription: [
        {
            events: [
                { id: 'SUBSCRIPTION_CREATED', label: 'Subscription Created', icon: '💳' },
                { id: 'SUBSCRIPTION_CANCELLED', label: 'Subscription Cancelled', icon: '❌' },
            ]
        },
    ],
    email: [
        {
            events: [
                { id: 'EMAIL_OPENED', label: 'Email Opened', icon: '📧' },
                { id: 'LINK_CLICKED', label: 'Link Clicked', icon: '🔗' },
                { id: 'CONTACT_UNSUBSCRIBED', label: 'Contact Unsubscribed', icon: '🚫' },
            ]
        },
    ],
    automation: [
        {
            events: [
                { id: 'WEBHOOK_RECEIVED', label: 'Webhook Received', icon: '🔗' },
            ]
        },
    ],
};

interface EventItem {
    id: string;
    label: string;
    icon: string;
}

interface EventSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (event: { triggerType: string; label: string }) => void;
}

export const EventSelectorModal: React.FC<EventSelectorModalProps> = ({
    isOpen,
    onClose,
    onSelect,
}) => {
    const [activeCategory, setActiveCategory] = useState<string>('woocommerce');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);

    // Filter events by search query
    const filteredEvents = useMemo(() => {
        const categoryEvents = EVENTS_BY_CATEGORY[activeCategory] || [];
        if (!searchQuery.trim()) return categoryEvents;

        const query = searchQuery.toLowerCase();
        return categoryEvents.map(group => ({
            ...group,
            events: group.events.filter(e => e.label.toLowerCase().includes(query))
        })).filter(g => g.events.length > 0);
    }, [activeCategory, searchQuery]);

    const handleDone = () => {
        if (selectedEvent) {
            onSelect({ triggerType: selectedEvent.id, label: selectedEvent.label });
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-900">Select an Event</h2>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent w-40"
                            />
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex flex-1 overflow-hidden">
                    {/* Category Sidebar */}
                    <div className="w-44 bg-gray-50 border-r py-2 overflow-y-auto">
                        {EVENT_CATEGORIES.map((cat) => {
                            const Icon = cat.icon;
                            return (
                                <button
                                    key={cat.id}
                                    onClick={() => {
                                        setActiveCategory(cat.id);
                                        setSelectedEvent(null);
                                    }}
                                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors ${activeCategory === cat.id
                                        ? 'bg-white text-blue-600 font-medium border-r-2 border-blue-600'
                                        : 'text-gray-600 hover:bg-gray-100'
                                        }`}
                                >
                                    <Icon size={16} />
                                    {cat.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Events List */}
                    <div className="flex-1 p-5 overflow-y-auto">
                        {filteredEvents.map((group, idx) => (
                            <div key={idx} className="mb-5 last:mb-0">
                                {group.subcategory && (
                                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                        {group.subcategory}
                                    </h3>
                                )}
                                <div className="flex flex-wrap gap-2">
                                    {group.events.map((event) => (
                                        <button
                                            key={event.id}
                                            onClick={() => setSelectedEvent(event)}
                                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-full transition-all ${selectedEvent?.id === event.id
                                                ? 'bg-blue-50 border-blue-400 text-blue-700 ring-2 ring-blue-200'
                                                : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                                                }`}
                                        >
                                            <span>{event.icon}</span>
                                            {event.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                        {filteredEvents.length === 0 && (
                            <div className="text-center text-gray-500 py-8">
                                No events found matching "{searchQuery}"
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleDone}
                        disabled={!selectedEvent}
                        className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};
