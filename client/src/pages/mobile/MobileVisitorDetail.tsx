import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, MapPin, Monitor, Smartphone, Tablet, Globe, Clock, ShoppingCart, Eye, Search, CreditCard, Package, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface AnalyticsEvent {
    id: string;
    type: string;
    url?: string;
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
        lastActiveAt: string;
        events?: AnalyticsEvent[];
    };
    visits?: AnalyticsVisit[];
    customer?: {
        firstName?: string;
        lastName?: string;
        email?: string;
        wooId?: number;
        totalSpent?: number;
        currency?: string;
    };
    stats: {
        totalEvents: number;
        totalVisits?: number;
        firstSeen?: { createdAt: string };
    };
}

/**
 * Mobile Visit Section - Collapsible visit with events
 */
function VisitSection({ visit, isFirst, displayNumber }: { visit: AnalyticsVisit; isFirst: boolean; displayNumber: number }) {
    const [expanded, setExpanded] = useState(isFirst);

    const formatDuration = (start: string, end: string) => {
        const ms = new Date(end).getTime() - new Date(start).getTime();
        const mins = Math.floor(ms / 60000);
        if (mins < 1) return 'Less than 1 min';
        if (mins < 60) return `${mins} min`;
        return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    };

    return (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-3">
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full px-4 py-3 flex items-center justify-between text-left active:bg-gray-50"
            >
                <div className="flex items-center gap-2">
                    {expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                    <div>
                        <span className="font-semibold text-gray-900">Visit #{displayNumber}</span>
                        <span className="text-gray-500 text-sm ml-2">
                            {new Date(visit.startedAt).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>{visit.actions} actions</span>
                    <span>{formatDuration(visit.startedAt, visit.endedAt)}</span>
                </div>
            </button>

            {expanded && (
                <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                    {visit.utmSource && (
                        <div className="text-xs text-gray-500 mb-3 pb-2 border-b border-gray-50">
                            Source: <span className="font-medium text-gray-700">{visit.utmSource}</span>
                        </div>
                    )}
                    <div className="space-y-2">
                        {visit.events.map((event) => (
                            <EventItem key={event.id} event={event} />
                        ))}
                        {visit.events.length === 0 && (
                            <div className="text-sm text-gray-400 italic">No events in this visit</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Mobile Event Item - Single event in timeline
 */
function EventItem({ event }: { event: AnalyticsEvent }) {
    const payload = event.payload || {};

    const getEventConfig = (type: string) => {
        switch (type) {
            case 'pageview':
            case 'page_view':
                return { icon: <Eye size={14} className="text-blue-500" />, color: 'bg-blue-50', label: 'Viewed' };
            case 'product_view':
                return { icon: <Eye size={14} className="text-indigo-500" />, color: 'bg-indigo-50', label: 'Viewed Product' };
            case 'add_to_cart':
                return { icon: <ShoppingCart size={14} className="text-amber-500" />, color: 'bg-amber-50', label: 'Added to Cart' };
            case 'remove_from_cart':
                return { icon: <ShoppingCart size={14} className="text-gray-400" />, color: 'bg-gray-50', label: 'Removed from Cart' };
            case 'checkout_start':
            case 'checkout_view':
                return { icon: <CreditCard size={14} className="text-purple-500" />, color: 'bg-purple-50', label: 'At Checkout' };
            case 'purchase':
            case 'checkout_success':
                return { icon: <Package size={14} className="text-green-500" />, color: 'bg-green-50', label: 'Purchased' };
            case 'search':
                return { icon: <Search size={14} className="text-amber-600" />, color: 'bg-amber-50', label: 'Searched' };
            default:
                return { icon: <Clock size={14} className="text-gray-400" />, color: 'bg-gray-50', label: type.replace(/_/g, ' ') };
        }
    };

    const config = getEventConfig(event.type);
    const time = new Date(event.createdAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

    return (
        <div className="flex items-start gap-3">
            <div className={`w-7 h-7 rounded-full ${config.color} flex items-center justify-center flex-shrink-0`}>
                {config.icon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">
                        {event.type === 'product_view' && (payload.productName || event.pageTitle || config.label)}
                        {event.type === 'search' && `Searched "${payload.term || payload.searchQuery || 'unknown'}"`}
                        {event.type === 'add_to_cart' && (payload.name || payload.productName || 'Added to cart')}
                        {event.type === 'purchase' && (
                            <span className="text-green-600">
                                Purchased {payload.total && `$${payload.total}`}
                            </span>
                        )}
                        {!['product_view', 'search', 'add_to_cart', 'purchase'].includes(event.type) && (event.pageTitle || config.label)}
                    </span>
                    <span className="text-xs text-gray-400 ml-2">{time}</span>
                </div>
                {event.url && event.type === 'pageview' && (
                    <p className="text-xs text-gray-500 truncate mt-0.5">{event.url}</p>
                )}
            </div>
        </div>
    );
}

/**
 * MobileVisitorDetail - Shows full visitor profile and event timeline.
 * Matches desktop VisitorProfileModal structure with visits containing events.
 */
export function MobileVisitorDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<VisitorData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchVisitorProfile();
    }, [id, currentAccount, token]);

    const fetchVisitorProfile = async () => {
        if (!currentAccount || !token || !id) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const res = await fetch(`/api/analytics/visitors/${id}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok) {
                const json = await res.json();
                setData(json);
            }
        } catch (error) {
            Logger.error('[MobileVisitorDetail] Error:', { error: error });
        } finally {
            setLoading(false);
        }
    };

    const getDeviceIcon = (deviceType: string | null | undefined) => {
        if (deviceType === 'mobile') return <Smartphone size={16} className="text-gray-500" />;
        if (deviceType === 'tablet') return <Tablet size={16} className="text-gray-500" />;
        return <Monitor size={16} className="text-gray-500" />;
    };

    // Get legacy events for sessions without visits
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

    if (loading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-1/3" />
                <div className="h-32 bg-gray-200 rounded-xl" />
                {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
            </div>
        );
    }

    if (!data) {
        return (
            <div className="text-center py-16">
                <p className="text-gray-500">Visitor not found</p>
                <button onClick={() => navigate(-1)} className="mt-4 text-indigo-600">Go Back</button>
            </div>
        );
    }

    // Visitor name: prioritize customer data, then email, then anonymous
    const visitorName = data.customer
        ? `${data.customer.firstName || ''} ${data.customer.lastName || ''}`.trim() || data.customer.email || 'Customer'
        : data.session.email || 'Anonymous Visitor';

    return (
        <div className="space-y-4 pb-8">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
                    <ArrowLeft size={22} className="text-gray-700" />
                </button>
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-gray-900 truncate">{visitorName}</h1>
                    <p className="text-sm text-gray-500">
                        {data.stats.totalVisits ? `${data.stats.totalVisits} visit${data.stats.totalVisits > 1 ? 's' : ''}` : 'Visitor Profile'}
                    </p>
                </div>
                <button onClick={fetchVisitorProfile} className="p-2 rounded-full hover:bg-gray-100">
                    <RefreshCw size={20} className="text-gray-600" />
                </button>
            </div>

            {/* Profile Card */}
            <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold">
                        {visitorName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                        <p className="font-semibold text-gray-900">{visitorName}</p>
                        {data.session.email && <p className="text-sm text-gray-500">{data.session.email}</p>}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                    {data.session.country && (
                        <div className="flex items-center gap-2 text-gray-600">
                            <MapPin size={14} />
                            <span>{data.session.city ? `${data.session.city}, ${data.session.country}` : data.session.country}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 text-gray-600">
                        {getDeviceIcon(data.session.deviceType)}
                        <span>{data.session.browser || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                        <Globe size={14} />
                        <span>{data.stats.totalVisits || 0} sessions</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                        <Eye size={14} />
                        <span>{data.stats.totalEvents || 0} events</span>
                    </div>
                </div>

                {/* Customer badge if linked */}
                {data.customer && (
                    <div className="mt-4 pt-3 border-t border-gray-100">
                        <div className="bg-green-50 text-green-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
                            <Package size={16} />
                            <span className="font-medium">Customer</span>
                            {data.customer.totalSpent !== undefined && (
                                <span className="ml-auto">${data.customer.totalSpent}</span>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Activity Timeline */}
            <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Activity Timeline</h2>

                {/* Render visits if available (preferred structure) */}
                {data.visits && data.visits.length > 0 ? (
                    <div>
                        {data.visits.map((visit, idx) => (
                            <VisitSection
                                key={visit.id}
                                visit={visit}
                                isFirst={idx === 0}
                                displayNumber={data.visits!.length - idx}
                            />
                        ))}
                    </div>
                ) : (
                    /* Fallback: Legacy flat events */
                    <div className="bg-white rounded-xl border border-gray-100 p-4">
                        <div className="space-y-3">
                            {getLegacyEvents().length > 0 ? (
                                getLegacyEvents().map((event) => (
                                    <EventItem key={event.id} event={event} />
                                ))
                            ) : (
                                <p className="text-sm text-gray-400 italic text-center py-4">No events recorded</p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
