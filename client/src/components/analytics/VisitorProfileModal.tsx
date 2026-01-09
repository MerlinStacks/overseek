
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { X, User, MapPin, Clock, Smartphone, Monitor, ShoppingBag, Search, ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { format, formatDistanceStrict } from 'date-fns';

interface VisitorProfileModalProps {
    visitorId: string;
    accountId: string;
    onClose: () => void;
}

interface AnalyticsEvent {
    id: string;
    type: string;
    url: string;
    pageTitle?: string;
    payload?: any;
    createdAt: string;
}

interface AnalyticsVisit {
    id: string;
    visitNumber: number;
    startedAt: string;
    endedAt: string;
    referrer?: string;
    utmSource?: string;
    deviceType?: string;
    browser?: string;
    os?: string;
    country?: string;
    city?: string;
    pageviews: number;
    actions: number;
    events: AnalyticsEvent[];
}

interface VisitorData {
    session: {
        id: string;
        visitorId: string;
        email?: string;
        ipAddress?: string;
        city?: string;
        country?: string;
        deviceType?: string;
        browser?: string;
        os?: string;
        referrer?: string;
        utmSource?: string;
        utmMedium?: string;
        lastActiveAt: string;
        wooCustomerId?: number;
        events?: AnalyticsEvent[]; // Legacy flat events
    };
    visits?: AnalyticsVisit[];
    customer?: any;
    stats: {
        totalEvents: number;
        totalVisits?: number;
        firstSeen?: { createdAt: string };
    };
}

/**
 * Renders a single event in the activity timeline
 */
const EventItem: React.FC<{ event: AnalyticsEvent }> = ({ event }) => {
    const payload = event.payload || {};

    const getEventColor = (type: string) => {
        if (type.includes('cart')) return 'bg-amber-400';
        if (type === 'purchase') return 'bg-green-500';
        if (type === 'product_view') return 'bg-indigo-400';
        if (type === 'checkout_start') return 'bg-orange-400';
        if (type === 'search') return 'bg-purple-400';
        return 'bg-blue-300';
    };

    return (
        <div className="relative pl-6">
            <div className={`absolute left-0 top-1 w-3 h-3 rounded-full border-2 border-white shadow-xs ${getEventColor(event.type)}`} />
            <div className="flex flex-col">
                <span className="text-xs text-gray-400 mb-0.5">
                    {format(new Date(event.createdAt), 'HH:mm:ss')} • <span className="capitalize">{event.type.replace(/_/g, ' ')}</span>
                </span>
                <div className="text-sm text-gray-700">
                    {event.type === 'pageview' && (
                        <div>
                            <span className="font-medium">Viewed {event.pageTitle || 'page'}</span>
                            <a href={event.url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline truncate block mt-0.5 max-w-md">
                                {event.url}
                            </a>
                        </div>
                    )}
                    {event.type === 'product_view' && (
                        <div>
                            <span className="font-medium text-indigo-700">
                                Viewed {payload.productName || 'Product'}
                            </span>
                            {payload.sku && (
                                <span className="text-xs text-gray-400 ml-2">SKU: {payload.sku}</span>
                            )}
                        </div>
                    )}
                    {event.type === 'search' && (
                        <span className="flex items-center gap-1 font-medium text-purple-600">
                            <Search className="w-3 h-3" /> Searched "{payload.term || payload.searchQuery || 'unknown'}"
                        </span>
                    )}
                    {event.type === 'add_to_cart' && (
                        <div>
                            <span className="font-medium text-amber-700">
                                Added to cart: {payload.name || payload.productName || 'Product'}
                            </span>
                            {payload.quantity && <span className="text-xs ml-1">(×{payload.quantity})</span>}
                            {payload.price && (
                                <span className="ml-2 text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-sm">
                                    ${payload.price}
                                </span>
                            )}
                        </div>
                    )}
                    {event.type === 'remove_from_cart' && (
                        <span className="text-gray-500">Removed item from cart</span>
                    )}
                    {event.type === 'checkout_start' && (
                        <div>
                            <span className="font-medium text-orange-600">Started checkout</span>
                            {payload.total && (
                                <span className="ml-2 text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-sm">
                                    Cart: ${payload.total}
                                </span>
                            )}
                        </div>
                    )}
                    {event.type === 'purchase' && (
                        <div>
                            <span className="font-medium text-green-600">Purchase completed</span>
                            {payload.total && (
                                <span className="ml-2 text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-sm font-semibold">
                                    ${payload.total} {payload.currency || ''}
                                </span>
                            )}
                            {payload.orderId && (
                                <span className="text-xs text-gray-400 ml-2">Order #{payload.orderId}</span>
                            )}
                        </div>
                    )}
                    {!['pageview', 'product_view', 'search', 'add_to_cart', 'remove_from_cart', 'checkout_start', 'purchase'].includes(event.type) && (
                        <span className="text-gray-500 capitalize">{event.type.replace(/_/g, ' ')}</span>
                    )}
                </div>
            </div>
        </div>
    );
};

/**
 * Renders a collapsible visit section
 */
const VisitSection: React.FC<{ visit: AnalyticsVisit; isFirst: boolean; totalVisits: number }> = ({ visit, isFirst, totalVisits }) => {
    const [expanded, setExpanded] = useState(isFirst);

    const duration = formatDistanceStrict(
        new Date(visit.startedAt),
        new Date(visit.endedAt),
        { addSuffix: false }
    );

    // Deduplicate events: hide pageview when product_view exists for same URL
    const productViewUrls = new Set<string>();
    visit.events.forEach(ev => {
        if (ev.type === 'product_view' && ev.url) productViewUrls.add(ev.url);
    });
    const dedupedEvents = visit.events.filter(ev => {
        if (ev.type === 'pageview' && ev.url && productViewUrls.has(ev.url)) return false;
        return true;
    });

    // Reversed visit number (so newest is #1, oldest is #N)
    const displayNumber = totalVisits - visit.visitNumber + 1;

    return (
        <div className="border border-gray-200 rounded-lg mb-3 overflow-hidden">
            {/* Visit Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between text-left"
            >
                <div className="flex items-center gap-3">
                    {expanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                    ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                    )}
                    <div>
                        <span className="font-semibold text-gray-800">Visit #{displayNumber}</span>
                        <span className="text-gray-500 text-sm ml-2">
                            {format(new Date(visit.startedAt), 'MMM d, yyyy h:mm a')}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                        <Eye className="w-3 h-3" /> {visit.actions} actions
                    </span>
                    <span>{duration}</span>
                </div>
            </button>

            {/* Visit Events */}
            {expanded && (
                <div className="p-4 bg-white border-t border-gray-100">
                    {/* Visit Meta */}
                    {(visit.utmSource || visit.referrer) && (
                        <div className="mb-4 pb-3 border-b border-gray-100 text-xs text-gray-500 flex gap-4">
                            {visit.utmSource && <span>Source: <strong className="text-gray-700">{visit.utmSource}</strong></span>}
                            {visit.referrer && <span className="truncate max-w-xs">Referrer: {visit.referrer}</span>}
                        </div>
                    )}

                    <div className="space-y-3 relative before:absolute before:left-1.5 before:top-2 before:bottom-0 before:w-0.5 before:bg-gray-100">
                        {dedupedEvents.map(event => (
                            <EventItem key={event.id} event={event} />
                        ))}
                        {dedupedEvents.length === 0 && (
                            <div className="text-sm text-gray-400 italic pl-6">No events in this visit.</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const VisitorProfileModal: React.FC<VisitorProfileModalProps> = ({ visitorId, accountId, onClose }) => {
    const [data, setData] = useState<VisitorData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await fetch(`/api/analytics/visitors/${visitorId}`, {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`,
                        'x-account-id': accountId
                    }
                });
                if (res.ok) {
                    const json = await res.json();
                    setData(json);
                }
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [visitorId, accountId]);

    if (!visitorId) return null;

    // Deduplicate legacy events (for sessions without visits)
    const getLegacyEvents = () => {
        if (!data?.session?.events) return [];
        const productViewUrls = new Set<string>();
        data.session.events.forEach(ev => {
            if (ev.type === 'product_view' && ev.url) productViewUrls.add(ev.url);
        });
        return data.session.events.filter(ev => {
            if (ev.type === 'pageview' && ev.url && productViewUrls.has(ev.url)) return false;
            return true;
        });
    };

    return ReactDOM.createPortal(
        <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex items-start justify-between bg-gray-50/50">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                            <User className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-800">
                                {data?.session?.email || 'Guest Visitor'}
                            </h2>
                            <div className="text-sm text-gray-500 font-mono">
                                {visitorId}
                            </div>
                            {data?.stats?.totalVisits && data.stats.totalVisits > 0 && (
                                <div className="text-xs text-blue-600 mt-1">
                                    {data.stats.totalVisits} visit{data.stats.totalVisits > 1 ? 's' : ''}
                                </div>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors shadow-xs"
                        title="Close"
                    >
                        <X className="w-6 h-6 text-gray-600" />
                    </button>
                </div>

                {loading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                ) : !data ? (
                    <div className="p-8 text-center text-gray-500">Visitor not found</div>
                ) : (
                    <div className="flex-1 overflow-hidden flex">
                        {/* Sidebar: Details */}
                        <div className="w-1/3 bg-gray-50 p-6 border-r border-gray-100 overflow-y-auto">
                            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Details</h3>

                            <div className="space-y-4 text-sm">
                                <div className="flex items-center gap-2 text-gray-600">
                                    <MapPin className="w-4 h-4 text-gray-400" />
                                    <span>{data.session.city || 'Unknown City'}, {data.session.country || 'Unknown Country'}</span>
                                </div>
                                <div className="flex items-center gap-2 text-gray-600">
                                    {data.session.deviceType === 'mobile' ? <Smartphone className="w-4 h-4 text-gray-400" /> : <Monitor className="w-4 h-4 text-gray-400" />}
                                    <span>{data.session.os} • {data.session.browser}</span>
                                </div>
                                <div className="flex items-center gap-2 text-gray-600">
                                    <Clock className="w-4 h-4 text-gray-400" />
                                    <span>Last Active: {format(new Date(data.session.lastActiveAt), 'MMM d, HH:mm')}</span>
                                </div>
                            </div>

                            <hr className="my-6 border-gray-200" />

                            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Attribution</h3>
                            <div className="space-y-2 text-sm">
                                <div>
                                    <span className="text-gray-400 block text-xs">Source</span>
                                    <span className="font-medium text-gray-700">{data.session.utmSource || 'Direct'}</span>
                                </div>
                                {data.session.utmMedium && (
                                    <div>
                                        <span className="text-gray-400 block text-xs">Medium</span>
                                        <span className="font-medium text-gray-700">{data.session.utmMedium}</span>
                                    </div>
                                )}
                                <div>
                                    <span className="text-gray-400 block text-xs">Referrer</span>
                                    <span className="truncate block text-gray-700" title={data.session.referrer}>{data.session.referrer || '-'}</span>
                                </div>
                            </div>

                            <hr className="my-6 border-gray-200" />

                            {data.customer && (
                                <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                                    <h4 className="text-emerald-800 font-semibold mb-1 flex items-center gap-2">
                                        <ShoppingBag className="w-3 h-3" /> Existing Customer
                                    </h4>
                                    <p className="text-xs text-emerald-600">WooCommerce ID: {data.customer.wooId}</p>
                                    <p className="text-xs text-emerald-600">Total Spent: {data.customer.totalSpent} {data.customer.currency}</p>
                                </div>
                            )}

                        </div>

                        {/* Main Content: Visit History */}
                        <div className="w-2/3 p-6 overflow-y-auto bg-white">
                            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
                                Visit History
                            </h3>

                            {/* Render visits if available */}
                            {data.visits && data.visits.length > 0 ? (
                                <div>
                                    {data.visits.map((visit, idx) => (
                                        <VisitSection
                                            key={visit.id}
                                            visit={visit}
                                            isFirst={idx === 0}
                                            totalVisits={data.stats?.totalVisits || data.visits!.length}
                                        />
                                    ))}
                                </div>
                            ) : (
                                /* Fallback: Legacy flat event list */
                                <div className="space-y-3 relative before:absolute before:left-1.5 before:top-2 before:bottom-0 before:w-0.5 before:bg-gray-100">
                                    {getLegacyEvents().map(event => (
                                        <EventItem key={event.id} event={event} />
                                    ))}
                                    {getLegacyEvents().length === 0 && (
                                        <div className="text-sm text-gray-400 italic pl-6">No events recorded.</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};

export default VisitorProfileModal;
