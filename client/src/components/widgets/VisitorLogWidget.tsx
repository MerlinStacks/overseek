/**
 * VisitorLogWidget - Real-time visitor activity stream (Matomo-style)
 * Shows visitors with their recent actions as clickable icons
 */
import { useState, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { Users, Clock, MapPin, FileText, Search, ShoppingCart, Eye, ExternalLink, User, RefreshCw, Globe, Link2, Flag, DollarSign } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import VisitorProfileModal from '../analytics/VisitorProfileModal';
import { DeviceBrowserBadge } from '../analytics/DeviceBrowserIcons';

interface PayloadItem {
    id?: number;
    sku?: string;
    name?: string;
    quantity?: number;
    price?: number;
}

interface EventPayload {
    total?: number;
    currency?: string;
    itemCount?: number;
    name?: string;
    is404?: boolean;
    items?: PayloadItem[];
    [key: string]: unknown;
}

interface VisitorEvent {
    id: string;
    type: string;
    url?: string;
    pageTitle?: string;
    createdAt: string;
    payload?: EventPayload;
}

interface VisitorSession {
    id: string;
    visitorId: string;
    email?: string;
    ipAddress?: string;
    country?: string;
    city?: string;
    lastActiveAt: string;
    currentPath: string;
    referrer?: string;
    deviceType?: string;
    browser?: string;
    os?: string;
    // UTM Attribution
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    lastTouchSource?: string;
    // Cross-visit tracking fields
    totalVisits?: number;
    firstTouchSource?: string;
    firstTouchAt?: string;
    _count?: {
        events: number;
    };
    events?: VisitorEvent[];
    customer?: {
        firstName?: string | null;
        lastName?: string | null;
        email?: string;
    } | null;
}

/** Returns an icon component based on event type and payload */
function getEventIcon(type: string, payload?: EventPayload) {
    // 404 pages get a flag icon
    if (type === 'pageview' && payload?.is404) {
        return Flag;
    }
    // Purchases show a dollar sign
    if (type === 'purchase') {
        return DollarSign;
    }
    switch (type) {
        case 'pageview':
            return FileText;
        case 'product_view':
            return Eye;
        case 'search':
            return Search;
        case 'add_to_cart':
        case 'remove_from_cart':
        case 'cart_view':
        case 'checkout_view':
        case 'checkout_start':
        case 'checkout_success':
            return ShoppingCart;
        default:
            return Eye;
    }
}

/** Returns tailwind classes for event icon based on type and payload */
function getEventIconClasses(type: string, payload?: EventPayload) {
    // 404 pages get red styling
    if (type === 'pageview' && payload?.is404) {
        return 'bg-red-50 text-red-600 hover:bg-red-100';
    }
    switch (type) {
        case 'pageview':
            return 'bg-blue-50 text-blue-500 hover:bg-blue-100';
        case 'product_view':
            return 'bg-indigo-50 text-indigo-500 hover:bg-indigo-100';
        case 'search':
            return 'bg-purple-50 text-purple-500 hover:bg-purple-100';
        case 'add_to_cart':
        case 'remove_from_cart':
        case 'cart_view':
        case 'checkout_view':
        case 'checkout_start':
        case 'checkout_success':
            return 'bg-amber-50 text-amber-600 hover:bg-amber-100';
        case 'purchase':
            return 'bg-green-50 text-green-600 hover:bg-green-100';
        default:
            return 'bg-gray-50 text-gray-500 hover:bg-gray-100';
    }
}

/** 
 * De-duplicate events: when both pageview and product_view exist for the SAME URL,
 * keep only product_view (more specific). All other events are preserved.
 */
function deduplicateEvents(events: VisitorEvent[]): VisitorEvent[] {
    // Find URLs that have product_view events
    const productViewUrls = new Set<string>();
    for (const event of events) {
        if (event.type === 'product_view' && event.url) {
            productViewUrls.add(event.url);
        }
    }

    // Filter out pageviews for URLs that also have product_view
    return events.filter(event => {
        if (event.type === 'pageview' && event.url && productViewUrls.has(event.url)) {
            return false; // Skip this pageview, product_view will be shown instead
        }
        return true;
    });
}

const VisitorLogWidget = (_props: { settings?: any }) => {
    const [visitors, setVisitors] = useState<VisitorSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedVisitor, setSelectedVisitor] = useState<string | null>(null);

    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const fetchLog = useCallback(async () => {
        if (!token || !currentAccount) return;

        try {
            const res = await fetch('/api/analytics/visitors/log?limit=15&live=true', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const json = await res.json();
                setVisitors(json.data);
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setLoading(false);
        }
    }, [token, currentAccount]);

    // Use visibility-aware polling with tab coordination
    useVisibilityPolling(fetchLog, 15000, [fetchLog], 'visitor-log');

    if (loading && visitors.length === 0) {
        return <div className="p-4 text-xs text-gray-500">Loading log...</div>;
    }

    return (
        <div className="h-full overflow-hidden flex flex-col bg-white rounded-xl border border-gray-100 shadow-xs">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-500" />
                    <span className="font-semibold text-gray-800 text-sm">Live Visitor Log</span>
                </div>
                <span className="text-xs text-gray-400">{visitors.length} visitors</span>
            </div>

            {/* Visitor Stream */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {visitors.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 py-8">
                        <Users className="w-8 h-8 mb-2 opacity-50" />
                        <span className="text-sm">No recent visitors</span>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {visitors.map(v => (
                            <div
                                key={v.id}
                                className="p-3 hover:bg-gray-50/50 transition-colors cursor-pointer group"
                                onClick={() => setSelectedVisitor(v.visitorId)}
                            >
                                {/* Visitor Header Row */}
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                        {/* Avatar */}
                                        <div className="w-8 h-8 rounded-full bg-linear-to-br from-blue-400 to-blue-600 text-white flex items-center justify-center shrink-0 text-xs font-semibold shadow-xs">
                                            {v.email ? v.email.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
                                        </div>
                                        {/* Name & Location */}
                                        <div className="flex flex-col min-w-0">
                                            <span className="font-medium text-gray-800 text-sm truncate">
                                                {v.customer?.firstName
                                                    ? `${v.customer.firstName} ${v.customer.lastName || ''}`.trim()
                                                    : v.email || `Visitor ${v.visitorId.slice(0, 6)}`}
                                            </span>
                                            <div className="flex items-center gap-1.5 text-xs text-gray-400">
                                                {/* Device/Browser Icons */}
                                                <DeviceBrowserBadge
                                                    browser={v.browser}
                                                    os={v.os}
                                                    deviceType={v.deviceType}
                                                />
                                                <span className="mx-0.5">•</span>
                                                {v.country && (
                                                    <>
                                                        <MapPin className="w-3 h-3" />
                                                        <span className="truncate">{v.city ? `${v.city}, ` : ''}{v.country}</span>
                                                        <span className="mx-0.5">•</span>
                                                    </>
                                                )}
                                                <Clock className="w-3 h-3" />
                                                <span>{formatDistanceToNowStrict(new Date(v.lastActiveAt))} ago</span>
                                            </div>
                                            {/* Traffic Source Row */}
                                            {(v.utmCampaign || v.utmSource || v.referrer) && (
                                                <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
                                                    <Link2 className="w-3 h-3 text-blue-400" />
                                                    <span className="truncate">
                                                        {v.utmCampaign ? (
                                                            <>
                                                                <span className="text-gray-400">Campaign:</span>{' '}
                                                                <span className="font-medium text-blue-600">{v.utmCampaign}</span>
                                                                {v.utmSource && <span className="text-gray-400"> via {v.utmSource}</span>}
                                                            </>
                                                        ) : v.utmSource ? (
                                                            <>
                                                                <span className="text-gray-400">Source:</span>{' '}
                                                                <span className="font-medium">{v.utmSource}</span>
                                                                {v.utmMedium && <span className="text-gray-400"> / {v.utmMedium}</span>}
                                                            </>
                                                        ) : v.referrer ? (
                                                            <>
                                                                <span className="text-gray-400">Referrer:</span>{' '}
                                                                <span className="font-medium">{v.referrer.replace(/^https?:\/\//, '').split('/')[0]}</span>
                                                            </>
                                                        ) : null}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {/* Actions count badge + Returning indicator */}
                                    <div className="flex items-center gap-2 shrink-0">
                                        {(v.totalVisits ?? 1) > 1 && (
                                            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full flex items-center gap-1" title={`${v.totalVisits} total visits since ${v.firstTouchAt ? new Date(v.firstTouchAt).toLocaleDateString() : 'first visit'}`}>
                                                <RefreshCw className="w-3 h-3" />
                                                Returning
                                            </span>
                                        )}
                                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                            {v._count?.events || 0} actions
                                        </span>
                                        <ExternalLink className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                </div>

                                {/* Action Icons Row */}
                                {v.events && v.events.length > 0 && (() => {
                                    const dedupedEvents = deduplicateEvents(v.events);
                                    return (
                                        <div className="flex items-center gap-1 pl-10 flex-wrap">
                                            {dedupedEvents.slice(0, 8).map((event, idx) => {
                                                const IconComponent = getEventIcon(event.type, event.payload);
                                                const iconClasses = getEventIconClasses(event.type, event.payload);

                                                // Build enhanced tooltip based on event type
                                                let tooltip = event.pageTitle || event.url || event.type;
                                                const payload = event.payload;

                                                if (event.type === 'purchase' && payload?.total) {
                                                    const currency = payload.currency || 'USD';
                                                    tooltip = `Ecommerce order\n- Revenue: ${currency}${payload.total.toFixed(2)}`;
                                                    // Show item details if available
                                                    if (payload.items && Array.isArray(payload.items) && payload.items.length > 0) {
                                                        const itemLines = payload.items.map((item: PayloadItem) => {
                                                            const sku = item.sku ? `${item.sku}: ` : '';
                                                            const name = item.name || 'Item';
                                                            const qty = item.quantity || 1;
                                                            const price = item.price !== undefined ? `, Price: ${currency}${item.price.toFixed(2)}` : '';
                                                            return `# ${sku}${name}, Quantity: ${qty}${price}`;
                                                        });
                                                        tooltip += '\n' + itemLines.join('\n');
                                                    }
                                                } else if (event.type === 'add_to_cart' && payload) {
                                                    const productName = payload.name || 'Product';
                                                    const cartTotal = payload.total;
                                                    const cartItems = payload.itemCount;
                                                    tooltip = `🛒 Added: ${productName}`;
                                                    if (cartTotal !== undefined && cartItems !== undefined) {
                                                        const currency = payload.currency || 'USD';
                                                        tooltip += `\nCart: ${currency} ${cartTotal.toFixed(2)} (${cartItems} items)`;
                                                    }
                                                } else if (event.type === 'pageview' && payload?.is404) {
                                                    tooltip = `⚠️ 404 Not Found: ${event.url || 'Unknown page'}`;
                                                }

                                                return (
                                                    <a
                                                        key={event.id}
                                                        href={event.url || '#'}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={(e) => e.stopPropagation()}
                                                        className={`w-6 h-6 rounded-sm flex items-center justify-center transition-colors ${iconClasses}`}
                                                        title={`${tooltip}\n${formatDistanceToNowStrict(new Date(event.createdAt))} ago`}
                                                    >
                                                        <IconComponent className="w-3 h-3" />
                                                    </a>
                                                );
                                            })}
                                            {dedupedEvents.length > 8 && (
                                                <span className="text-xs text-gray-400 ml-1">+{dedupedEvents.length - 8}</span>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Visitor Profile Modal */}
            {selectedVisitor && currentAccount && (
                <VisitorProfileModal
                    visitorId={selectedVisitor}
                    accountId={currentAccount.id}
                    onClose={() => setSelectedVisitor(null)}
                />
            )}
        </div>
    );
};

export default VisitorLogWidget;
