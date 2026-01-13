import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Globe, MapPin, Monitor, Smartphone, Tablet, Eye, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface LiveVisitor {
    id: string;
    visitorId: string;
    email: string | null;
    country: string | null;
    city: string | null;
    currentPath: string | null;
    deviceType: string | null;
    browser: string | null;
    lastActiveAt: string;
    utmSource: string | null;
    utmCampaign: string | null;
    customer: { firstName: string | null; lastName: string | null; email: string } | null;
    events: Array<{ type: string; pageTitle: string | null; createdAt: string }>;
}

export function MobileLiveVisitors() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [visitors, setVisitors] = useState<LiveVisitor[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);

    const fetchLiveVisitors = useCallback(async () => {
        if (!currentAccount || !token) return;

        try {
            const res = await fetch('/api/analytics/visitors/log?live=true&limit=30', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok) {
                const data = await res.json();
                setVisitors(data.data || []);
                setTotal(data.total || 0);
            }
        } catch (error) {
            console.error('[MobileLiveVisitors] Error:', error);
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchLiveVisitors();
        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchLiveVisitors, 30000);
        // Listen for pull-to-refresh events
        const handleRefresh = () => fetchLiveVisitors();
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => {
            clearInterval(interval);
            window.removeEventListener('mobile-refresh', handleRefresh);
        };
    }, [fetchLiveVisitors]);

    const getDeviceIcon = (deviceType: string | null) => {
        if (deviceType === 'mobile') return <Smartphone size={14} className="text-gray-500" />;
        if (deviceType === 'tablet') return <Tablet size={14} className="text-gray-500" />;
        return <Monitor size={14} className="text-gray-500" />;
    };

    const formatTimeAgo = (date: string) => {
        const now = new Date();
        const then = new Date(date);
        const diff = Math.floor((now.getTime() - then.getTime()) / 1000);
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return `${Math.floor(diff / 3600)}h ago`;
    };

    const getVisitorName = (v: LiveVisitor) => {
        if (v.customer) {
            return `${v.customer.firstName || ''} ${v.customer.lastName || ''}`.trim() || v.customer.email;
        }
        return v.email || 'Anonymous Visitor';
    };

    if (loading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-1/3" />
                {[...Array(8)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
                    <ArrowLeft size={22} className="text-gray-700" />
                </button>
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-gray-900">Live Visitors</h1>
                    <p className="text-sm text-gray-500">{total} online now</p>
                </div>
                <button onClick={fetchLiveVisitors} className="p-2 rounded-full hover:bg-gray-100">
                    <RefreshCw size={20} className="text-gray-600" />
                </button>
            </div>

            {/* Live Indicator */}
            <div className="flex items-center gap-2 px-4 py-3 bg-green-50 rounded-xl border border-green-100">
                <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                </span>
                <span className="text-sm font-medium text-green-700">
                    {total} {total === 1 ? 'visitor' : 'visitors'} active in last 3 minutes
                </span>
            </div>

            {/* Visitor List */}
            <div className="space-y-3">
                {visitors.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                            <Users className="text-gray-400" size={36} />
                        </div>
                        <p className="text-gray-900 font-semibold mb-1">No live visitors</p>
                        <p className="text-gray-500 text-sm">Visitors will appear when they're active</p>
                    </div>
                ) : (
                    visitors.map((visitor) => (
                        <button
                            key={visitor.id}
                            onClick={() => navigate(`/m/visitor/${visitor.visitorId}`)}
                            className="w-full bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-left hover:border-indigo-200 hover:shadow-md transition-all active:scale-[0.98]"
                        >
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm">
                                        {getVisitorName(visitor).charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="font-semibold text-gray-900 text-sm">
                                            {getVisitorName(visitor)}
                                        </p>
                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                            {visitor.country && (
                                                <span className="flex items-center gap-1">
                                                    <MapPin size={12} />
                                                    {visitor.city ? `${visitor.city}, ${visitor.country}` : visitor.country}
                                                </span>
                                            )}
                                            {getDeviceIcon(visitor.deviceType)}
                                        </div>
                                    </div>
                                </div>
                                <span className="text-xs text-gray-500">{formatTimeAgo(visitor.lastActiveAt)}</span>
                            </div>

                            {/* Current Page */}
                            {visitor.currentPath && (
                                <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-gray-50 rounded-lg">
                                    <Eye size={14} className="text-indigo-600" />
                                    <span className="text-sm text-gray-700 truncate flex-1">
                                        {visitor.currentPath}
                                    </span>
                                </div>
                            )}

                            {/* UTM Source */}
                            {visitor.utmSource && (
                                <div className="flex items-center gap-2 mt-2">
                                    <Globe size={12} className="text-gray-400" />
                                    <span className="text-xs text-gray-500">
                                        via {visitor.utmSource}
                                        {visitor.utmCampaign && ` • ${visitor.utmCampaign}`}
                                    </span>
                                </div>
                            )}

                            {/* Recent Events */}
                            {visitor.events && visitor.events.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-100">
                                    {visitor.events.slice(0, 5).map((event, idx) => {
                                        const eventConfig: Record<string, { label: string; color: string }> = {
                                            'add_to_cart': { label: '🛒 Added to Cart', color: 'bg-blue-100 text-blue-700' },
                                            'remove_from_cart': { label: '❌ Removed', color: 'bg-gray-100 text-gray-600' },
                                            'cart_view': { label: '🛒 Viewing Cart', color: 'bg-blue-50 text-blue-600' },
                                            'checkout_view': { label: '💳 At Checkout', color: 'bg-purple-100 text-purple-700' },
                                            'checkout_start': { label: '💳 Started Checkout', color: 'bg-purple-100 text-purple-700' },
                                            'checkout_success': { label: '✅ Completed Checkout', color: 'bg-green-100 text-green-700' },
                                            'purchase': { label: '💰 Purchased', color: 'bg-green-100 text-green-700' },
                                            'page_view': { label: '👁️ ' + (event.pageTitle || 'Page View'), color: 'bg-gray-50 text-gray-600' },
                                            'search': { label: '🔍 Searched', color: 'bg-amber-50 text-amber-700' },
                                        };
                                        const config = eventConfig[event.type] || { label: event.type, color: 'bg-gray-50 text-gray-600' };

                                        // Skip page_view if there are more interesting events
                                        if (event.type === 'page_view' && visitor.events.some(e => e.type !== 'page_view')) {
                                            return null;
                                        }

                                        return (
                                            <span
                                                key={idx}
                                                className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config.color}`}
                                            >
                                                {config.label}
                                            </span>
                                        );
                                    })}
                                </div>
                            )}
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
