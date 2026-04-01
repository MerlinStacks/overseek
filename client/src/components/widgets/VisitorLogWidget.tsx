/**
 * VisitorLogWidget - Real-time visitor activity stream
 * Shows visitors with funnel status, cart value, and differentiated event icons.
 * Sorted by revenue potential (active carts first).
 */
import { useState, useCallback, useMemo } from 'react';
import { Logger } from '../../utils/logger';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import {
    Users, Clock, MapPin, FileText, Search, ShoppingCart, Eye, ExternalLink,
    User, RefreshCw, Link2, Flag, DollarSign, Plus, Minus, CreditCard,
    CheckCircle, PackageCheck, AlertTriangle
} from 'lucide-react';
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

interface CartItem {
    productId?: number;
    name?: string;
    quantity?: number;
    price?: number;
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
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    lastTouchSource?: string;
    totalVisits?: number;
    firstTouchSource?: string;
    firstTouchAt?: string;
    cartValue?: number;
    cartItems?: CartItem[];
    currency?: string;
    _count?: { events: number };
    events?: VisitorEvent[];
    customer?: {
        firstName?: string | null;
        lastName?: string | null;
        email?: string;
    } | null;
}

// --- Funnel stage detection ---

type FunnelStage = 'browsing' | 'product_interest' | 'shopping' | 'checking_out' | 'purchased' | 'abandoned';

interface FunnelInfo {
    stage: FunnelStage;
    label: string;
    color: string;       // tailwind badge bg/text classes
    dotColor: string;    // pulsing dot color
    priority: number;    // sort priority (higher = more important)
}

function getFunnelStage(v: VisitorSession): FunnelInfo {
    const events = v.events || [];
    const eventTypes = new Set(events.map(e => e.type));
    const cartVal = Number(v.cartValue) || 0;
    const minutesSinceActive = (Date.now() - new Date(v.lastActiveAt).getTime()) / 60000;

    // Purchased — highest priority
    if (eventTypes.has('purchase')) {
        return {
            stage: 'purchased',
            label: 'Purchased',
            color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
            dotColor: 'bg-emerald-500',
            priority: 100,
        };
    }

    // Checking out
    if (eventTypes.has('checkout_start') || eventTypes.has('checkout_view') || eventTypes.has('checkout_success')) {
        // Abandoned checkout? Cart + checkout events but idle > 5 min
        if (minutesSinceActive > 5) {
            return {
                stage: 'abandoned',
                label: 'Checkout Stalled',
                color: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
                dotColor: 'bg-red-500',
                priority: 90,
            };
        }
        return {
            stage: 'checking_out',
            label: 'Checking Out',
            color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
            dotColor: 'bg-blue-500',
            priority: 85,
        };
    }

    // Has items in cart
    if (cartVal > 0 || eventTypes.has('add_to_cart') || eventTypes.has('cart_view')) {
        // Cart abandoned — has cart but idle > 10 min
        if (minutesSinceActive > 10 && cartVal > 0) {
            return {
                stage: 'abandoned',
                label: 'Cart Abandoned',
                color: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
                dotColor: 'bg-red-500',
                priority: 80,
            };
        }
        return {
            stage: 'shopping',
            label: 'Shopping',
            color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
            dotColor: 'bg-amber-500',
            priority: 70,
        };
    }

    // Viewing products but no cart yet
    if (eventTypes.has('product_view')) {
        return {
            stage: 'product_interest',
            label: 'Viewing Products',
            color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400',
            dotColor: 'bg-indigo-500',
            priority: 40,
        };
    }

    // Just browsing
    return {
        stage: 'browsing',
        label: 'Browsing',
        color: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400',
        dotColor: 'bg-slate-400',
        priority: 10,
    };
}

// --- Differentiated event icons ---

function getEventIcon(type: string, payload?: EventPayload) {
    if (type === 'pageview' && payload?.is404) return Flag;
    switch (type) {
        case 'pageview':        return FileText;
        case 'product_view':    return Eye;
        case 'search':          return Search;
        case 'add_to_cart':     return Plus;
        case 'remove_from_cart': return Minus;
        case 'cart_view':       return ShoppingCart;
        case 'checkout_view':
        case 'checkout_start':  return CreditCard;
        case 'checkout_success': return CheckCircle;
        case 'purchase':        return DollarSign;
        default:                return Eye;
    }
}

function getEventIconClasses(type: string, payload?: EventPayload) {
    if (type === 'pageview' && payload?.is404) return 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400';
    switch (type) {
        case 'pageview':         return 'bg-slate-50 text-slate-500 hover:bg-slate-100 dark:bg-slate-700/50 dark:text-slate-400';
        case 'product_view':     return 'bg-indigo-50 text-indigo-500 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400';
        case 'search':           return 'bg-purple-50 text-purple-500 hover:bg-purple-100 dark:bg-purple-500/10 dark:text-purple-400';
        case 'add_to_cart':      return 'bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400';
        case 'remove_from_cart': return 'bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400';
        case 'cart_view':        return 'bg-amber-50 text-amber-500 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400';
        case 'checkout_view':
        case 'checkout_start':   return 'bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400';
        case 'checkout_success': return 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400';
        case 'purchase':         return 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400';
        default:                 return 'bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-slate-700/50 dark:text-slate-400';
    }
}

function getEventLabel(type: string, payload?: EventPayload): string {
    if (type === 'pageview' && payload?.is404) return '404 Page';
    switch (type) {
        case 'pageview':         return 'Page View';
        case 'product_view':     return 'Product View';
        case 'search':           return 'Search';
        case 'add_to_cart':      return 'Added to Cart';
        case 'remove_from_cart': return 'Removed from Cart';
        case 'cart_view':        return 'Viewed Cart';
        case 'checkout_view':    return 'Viewing Checkout';
        case 'checkout_start':   return 'Started Checkout';
        case 'checkout_success': return 'Checkout Complete';
        case 'purchase':         return 'Purchase';
        default:                 return type;
    }
}

/**
 * De-duplicate events: when both pageview and product_view exist for the SAME URL,
 * keep only product_view (more specific).
 */
function deduplicateEvents(events: VisitorEvent[]): VisitorEvent[] {
    const productViewUrls = new Set<string>();
    for (const event of events) {
        if (event.type === 'product_view' && event.url) {
            productViewUrls.add(event.url);
        }
    }
    return events.filter(event => {
        if (event.type === 'pageview' && event.url && productViewUrls.has(event.url)) return false;
        return true;
    });
}

/** Format currency value */
function fmtCurrency(value: number, currency = 'USD'): string {
    // Use compact notation for large values
    if (value >= 1000) {
        return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
    }
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

// --- Mini funnel progress bar ---

const FUNNEL_STEPS = ['browse', 'cart', 'checkout', 'purchase'] as const;

function getFunnelStep(stage: FunnelStage): number {
    switch (stage) {
        case 'browsing':
        case 'product_interest': return 0;
        case 'shopping':
        case 'abandoned':        return 1;
        case 'checking_out':     return 2;
        case 'purchased':        return 3;
        default:                 return 0;
    }
}

function MiniFunnel({ stage, abandoned }: { stage: FunnelStage; abandoned: boolean }) {
    const step = getFunnelStep(stage);
    return (
        <div className="flex items-center gap-0.5" title={`Funnel: ${FUNNEL_STEPS.map((s, i) => i <= step ? s.toUpperCase() : s).join(' > ')}`}>
            {FUNNEL_STEPS.map((s, i) => (
                <div
                    key={s}
                    className={`h-1.5 rounded-full transition-all ${
                        i <= step
                            ? abandoned && i === step
                                ? 'bg-red-400 dark:bg-red-500 w-4'
                                : i === step
                                    ? 'bg-current w-4'
                                    : 'bg-current/40 w-2.5'
                            : 'bg-slate-200 dark:bg-slate-700 w-2.5'
                    }`}
                />
            ))}
        </div>
    );
}

// --- Main widget ---

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

    useVisibilityPolling(fetchLog, 15000, [fetchLog], 'visitor-log');

    // Sort visitors by revenue potential: abandoned/checkout/shopping first, then by cart value
    const sortedVisitors = useMemo(() => {
        return [...visitors].sort((a, b) => {
            const funnelA = getFunnelStage(a);
            const funnelB = getFunnelStage(b);
            if (funnelA.priority !== funnelB.priority) return funnelB.priority - funnelA.priority;
            // Same funnel stage: sort by cart value desc
            const cartA = Number(a.cartValue) || 0;
            const cartB = Number(b.cartValue) || 0;
            if (cartA !== cartB) return cartB - cartA;
            // Finally by recency
            return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
        });
    }, [visitors]);

    // Summary stats
    const stats = useMemo(() => {
        let activeShoppers = 0;
        let totalCartValue = 0;
        for (const v of visitors) {
            const cv = Number(v.cartValue) || 0;
            if (cv > 0) {
                activeShoppers++;
                totalCartValue += cv;
            }
        }
        return { activeShoppers, totalCartValue };
    }, [visitors]);

    if (loading && visitors.length === 0) {
        return <div className="p-4 text-xs text-slate-500 dark:text-slate-400">Loading log...</div>;
    }

    return (
        <div className="h-full overflow-hidden flex flex-col bg-white dark:bg-slate-800/90 rounded-xl border border-slate-100 dark:border-slate-700/50 shadow-xs">
            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
                <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-500" />
                    <span className="font-semibold text-slate-800 dark:text-white text-sm">Live Visitor Log</span>
                </div>
                <div className="flex items-center gap-3">
                    {stats.activeShoppers > 0 && (
                        <span className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <ShoppingCart className="w-3 h-3" />
                            {stats.activeShoppers} cart{stats.activeShoppers !== 1 ? 's' : ''} &middot; {fmtCurrency(stats.totalCartValue)}
                        </span>
                    )}
                    <span className="text-xs text-slate-400 dark:text-slate-500">{visitors.length} live</span>
                </div>
            </div>

            {/* Visitor Stream */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {sortedVisitors.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 py-8">
                        <Users className="w-8 h-8 mb-2 opacity-50" />
                        <span className="text-sm">No recent visitors</span>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                        {sortedVisitors.map(v => {
                            const funnel = getFunnelStage(v);
                            const cartVal = Number(v.cartValue) || 0;
                            const isAbandoned = funnel.stage === 'abandoned';

                            return (
                                <div
                                    key={v.id}
                                    className={`p-3 hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer group ${
                                        isAbandoned ? 'border-l-2 border-l-red-400 dark:border-l-red-500' : ''
                                    }`}
                                    onClick={() => setSelectedVisitor(v.visitorId)}
                                >
                                    {/* Top Row: Identity + Status */}
                                    <div className="flex items-center justify-between mb-1.5">
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            {/* Avatar with funnel dot */}
                                            <div className="relative shrink-0">
                                                <div className="w-8 h-8 rounded-full bg-linear-to-br from-blue-400 to-blue-600 text-white flex items-center justify-center text-xs font-semibold shadow-xs">
                                                    {v.email ? v.email.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
                                                </div>
                                                <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-800 ${funnel.dotColor}`} />
                                            </div>
                                            {/* Name & Meta */}
                                            <div className="flex flex-col min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-slate-800 dark:text-slate-200 text-sm truncate">
                                                        {v.customer?.firstName
                                                            ? `${v.customer.firstName} ${v.customer.lastName || ''}`.trim()
                                                            : v.email || `Visitor ${v.visitorId.slice(0, 6)}`}
                                                    </span>
                                                    {(v.totalVisits ?? 1) > 1 && (
                                                        <span className="text-xs bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0" title={`${v.totalVisits} total visits`}>
                                                            <RefreshCw className="w-2.5 h-2.5" />
                                                            Returning
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                                                    <DeviceBrowserBadge browser={v.browser} os={v.os} deviceType={v.deviceType} />
                                                    {v.country && (
                                                        <>
                                                            <span className="mx-0.5">&middot;</span>
                                                            <MapPin className="w-3 h-3" />
                                                            <span className="truncate">{v.city ? `${v.city}, ` : ''}{v.country}</span>
                                                        </>
                                                    )}
                                                    <span className="mx-0.5">&middot;</span>
                                                    <Clock className="w-3 h-3" />
                                                    <span>{formatDistanceToNowStrict(new Date(v.lastActiveAt))} ago</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Right side: Status badge + cart value */}
                                        <div className="flex items-center gap-2 shrink-0 ml-2">
                                            {/* Cart value (prominent when > 0) */}
                                            {cartVal > 0 && funnel.stage !== 'purchased' && (
                                                <span className="text-sm font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1" title={`Cart: ${fmtCurrency(cartVal, v.currency)}`}>
                                                    <ShoppingCart className="w-3.5 h-3.5" />
                                                    {fmtCurrency(cartVal, v.currency)}
                                                </span>
                                            )}
                                            {/* Purchase revenue */}
                                            {funnel.stage === 'purchased' && (() => {
                                                const purchaseEvent = v.events?.find(e => e.type === 'purchase');
                                                const revenue = purchaseEvent?.payload?.total;
                                                if (revenue) {
                                                    return (
                                                        <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                            <DollarSign className="w-3.5 h-3.5" />
                                                            {fmtCurrency(revenue, purchaseEvent?.payload?.currency || v.currency)}
                                                        </span>
                                                    );
                                                }
                                                return null;
                                            })()}
                                            {/* Funnel status badge */}
                                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${funnel.color}`}>
                                                {isAbandoned && <AlertTriangle className="w-3 h-3" />}
                                                {funnel.stage === 'purchased' && <PackageCheck className="w-3 h-3" />}
                                                {funnel.label}
                                            </span>
                                            <ExternalLink className="w-3 h-3 text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </div>

                                    {/* Traffic Source Row */}
                                    {(v.utmCampaign || v.utmSource || v.referrer) && (
                                        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 pl-10 mb-1.5">
                                            <Link2 className="w-3 h-3 text-blue-400" />
                                            <span className="truncate">
                                                {v.utmCampaign ? (
                                                    <>
                                                        <span className="text-slate-400 dark:text-slate-500">Campaign:</span>{' '}
                                                        <span className="font-medium text-blue-600 dark:text-blue-400">{v.utmCampaign}</span>
                                                        {v.utmSource && <span className="text-slate-400 dark:text-slate-500"> via {v.utmSource}</span>}
                                                    </>
                                                ) : v.utmSource ? (
                                                    <>
                                                        <span className="text-slate-400 dark:text-slate-500">Source:</span>{' '}
                                                        <span className="font-medium">{v.utmSource}</span>
                                                        {v.utmMedium && <span className="text-slate-400 dark:text-slate-500"> / {v.utmMedium}</span>}
                                                    </>
                                                ) : v.referrer ? (
                                                    <>
                                                        <span className="text-slate-400 dark:text-slate-500">Referrer:</span>{' '}
                                                        <span className="font-medium">{v.referrer.replace(/^https?:\/\//, '').split('/')[0]}</span>
                                                    </>
                                                ) : null}
                                            </span>
                                        </div>
                                    )}

                                    {/* Action Icons Row + Mini Funnel */}
                                    {v.events && v.events.length > 0 && (() => {
                                        const dedupedEvents = deduplicateEvents(v.events);
                                        return (
                                            <div className="flex items-center justify-between pl-10">
                                                <div className="flex items-center gap-1 flex-wrap">
                                                    {dedupedEvents.slice(0, 8).map((event) => {
                                                        const IconComponent = getEventIcon(event.type, event.payload);
                                                        const iconClasses = getEventIconClasses(event.type, event.payload);
                                                        const label = getEventLabel(event.type, event.payload);

                                                        // Build tooltip
                                                        let tooltip = label;
                                                        const payload = event.payload;
                                                        if (event.type === 'purchase' && payload?.total) {
                                                            const cur = payload.currency || 'USD';
                                                            tooltip = `Purchase: ${cur} ${payload.total.toFixed(2)}`;
                                                            if (payload.items?.length) {
                                                                tooltip += '\n' + payload.items.map((item: PayloadItem) => {
                                                                    return `  ${item.name || 'Item'} x${item.quantity || 1}`;
                                                                }).join('\n');
                                                            }
                                                        } else if (event.type === 'add_to_cart' && payload) {
                                                            tooltip = `Added: ${payload.name || 'Product'}`;
                                                            if (payload.total !== undefined) {
                                                                tooltip += ` (cart: ${payload.currency || 'USD'} ${payload.total.toFixed(2)})`;
                                                            }
                                                        } else if (event.type === 'remove_from_cart' && payload) {
                                                            tooltip = `Removed: ${payload.name || 'Product'}`;
                                                        } else if (event.pageTitle || event.url) {
                                                            tooltip = `${label}: ${event.pageTitle || event.url}`;
                                                        }
                                                        if (event.type === 'pageview' && payload?.is404) {
                                                            tooltip = `404 Not Found: ${event.url || 'Unknown'}`;
                                                        }

                                                        return (
                                                            <a
                                                                key={event.id}
                                                                href={event.url || '#'}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                onClick={(e) => e.stopPropagation()}
                                                                className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${iconClasses}`}
                                                                title={`${tooltip}\n${formatDistanceToNowStrict(new Date(event.createdAt))} ago`}
                                                            >
                                                                <IconComponent className="w-3 h-3" />
                                                            </a>
                                                        );
                                                    })}
                                                    {dedupedEvents.length > 8 && (
                                                        <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">+{dedupedEvents.length - 8}</span>
                                                    )}
                                                </div>
                                                {/* Mini funnel progress */}
                                                <div className={`flex items-center gap-1.5 ${funnel.color.split(' ')[1]}`}>
                                                    <MiniFunnel stage={funnel.stage} abandoned={isAbandoned} />
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            );
                        })}
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
