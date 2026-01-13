import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, MapPin, Monitor, Smartphone, Tablet, Globe, Clock, ShoppingCart, Eye, Search, CreditCard, Package } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface VisitorEvent {
    id: string;
    type: string;
    pageTitle: string | null;
    pagePath: string | null;
    createdAt: string;
    metadata?: Record<string, unknown>;
}

interface VisitorProfile {
    id: string;
    visitorId: string;
    email: string | null;
    country: string | null;
    city: string | null;
    deviceType: string | null;
    browser: string | null;
    os: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    totalSessions: number;
    totalPageViews: number;
    customer: { firstName: string | null; lastName: string | null; email: string } | null;
    events: VisitorEvent[];
}

/**
 * MobileVisitorDetail - Shows full visitor profile and event timeline.
 * Navigated to from MobileLiveVisitors when clicking a visitor card.
 */
export function MobileVisitorDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [profile, setProfile] = useState<VisitorProfile | null>(null);
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
                const data = await res.json();
                setProfile(data);
            }
        } catch (error) {
            console.error('[MobileVisitorDetail] Error:', error);
        } finally {
            setLoading(false);
        }
    };

    const getDeviceIcon = (deviceType: string | null) => {
        if (deviceType === 'mobile') return <Smartphone size={16} className="text-gray-500" />;
        if (deviceType === 'tablet') return <Tablet size={16} className="text-gray-500" />;
        return <Monitor size={16} className="text-gray-500" />;
    };

    const formatTime = (date: string) => {
        return new Date(date).toLocaleTimeString('en-AU', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    };

    const formatDate = (date: string) => {
        return new Date(date).toLocaleDateString('en-AU', {
            weekday: 'short',
            day: 'numeric',
            month: 'short'
        });
    };

    const getEventIcon = (type: string) => {
        switch (type) {
            case 'page_view': return <Eye size={14} className="text-gray-500" />;
            case 'add_to_cart': return <ShoppingCart size={14} className="text-blue-500" />;
            case 'checkout_start':
            case 'checkout_view': return <CreditCard size={14} className="text-purple-500" />;
            case 'purchase':
            case 'checkout_success': return <Package size={14} className="text-green-500" />;
            case 'search': return <Search size={14} className="text-amber-500" />;
            default: return <Clock size={14} className="text-gray-400" />;
        }
    };

    const getEventLabel = (event: VisitorEvent) => {
        switch (event.type) {
            case 'page_view': return event.pageTitle || event.pagePath || 'Page View';
            case 'add_to_cart': return 'Added to Cart';
            case 'remove_from_cart': return 'Removed from Cart';
            case 'checkout_start': return 'Started Checkout';
            case 'checkout_view': return 'Viewing Checkout';
            case 'checkout_success':
            case 'purchase': return 'Completed Purchase';
            case 'search': return `Searched: "${(event.metadata as any)?.query || 'unknown'}"`;
            default: return event.type.replace(/_/g, ' ');
        }
    };

    if (loading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-1/3" />
                <div className="h-32 bg-gray-200 rounded-xl" />
                {[...Array(6)].map((_, i) => <div key={i} className="h-16 bg-gray-200 rounded-xl" />)}
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="text-center py-16">
                <p className="text-gray-500">Visitor not found</p>
                <button onClick={() => navigate(-1)} className="mt-4 text-indigo-600">Go Back</button>
            </div>
        );
    }

    const visitorName = profile.customer
        ? `${profile.customer.firstName || ''} ${profile.customer.lastName || ''}`.trim() || profile.customer.email
        : profile.email || 'Anonymous Visitor';

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
                    <ArrowLeft size={22} className="text-gray-700" />
                </button>
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-gray-900 truncate">{visitorName}</h1>
                    <p className="text-sm text-gray-500">Visitor Profile</p>
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
                        {profile.email && <p className="text-sm text-gray-500">{profile.email}</p>}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                    {profile.country && (
                        <div className="flex items-center gap-2 text-gray-600">
                            <MapPin size={14} />
                            <span>{profile.city ? `${profile.city}, ${profile.country}` : profile.country}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 text-gray-600">
                        {getDeviceIcon(profile.deviceType)}
                        <span>{profile.browser || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                        <Globe size={14} />
                        <span>{profile.totalSessions} sessions</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                        <Eye size={14} />
                        <span>{profile.totalPageViews} page views</span>
                    </div>
                </div>
            </div>

            {/* Timeline */}
            <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Activity Timeline</h2>
                <div className="space-y-2">
                    {profile.events && profile.events.length > 0 ? (
                        profile.events.slice(0, 50).map((event) => (
                            <div key={event.id} className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-100">
                                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                                    {getEventIcon(event.type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 truncate">
                                        {getEventLabel(event)}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {formatDate(event.createdAt)} at {formatTime(event.createdAt)}
                                    </p>
                                </div>
                            </div>
                        ))
                    ) : (
                        <p className="text-sm text-gray-500 text-center py-8">No events recorded</p>
                    )}
                </div>
            </div>
        </div>
    );
}
