import { useState, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Globe, MapPin, Monitor, Smartphone, Tablet, Eye, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { formatTimeAgo } from '../../utils/format';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';

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
    const [liveCount, setLiveCount] = useState(0);

    const fetchVisitors = useCallback(async () => {
        if (!currentAccount || !token) return;

        try {
            // Fetch last 50 visitors (not filtered by live status)
            const [visitorsRes, liveRes] = await Promise.all([
                fetch('/api/analytics/visitors/log?limit=50', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id
                    }
                }),
                // Separate call to get accurate live count (last 3 minutes)
                fetch('/api/analytics/visitors/log?live=true&limit=1', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id
                    }
                })
            ]);

            if (visitorsRes.ok) {
                const data = await visitorsRes.json();
                setVisitors(data.data || []);
            }
            if (liveRes.ok) {
                const liveData = await liveRes.json();
                setLiveCount(liveData.total || 0);
            }
        } catch (error) {
            Logger.error('[MobileLiveVisitors] Error:', { error: error });
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token]);

    // Visibility-aware polling: pauses when app is backgrounded/screen off
    useVisibilityPolling(fetchVisitors, 30000, [fetchVisitors]);

    const getDeviceIcon = (deviceType: string | null) => {
        if (deviceType === 'mobile') return <Smartphone size={14} className="text-slate-400" />;
        if (deviceType === 'tablet') return <Tablet size={14} className="text-slate-400" />;
        return <Monitor size={14} className="text-slate-400" />;
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
                <div className="h-8 pwa-skeleton w-1/3" />
                {[...Array(8)].map((_, i) => <div key={i} className="h-20 pwa-card" />)}
            </div>
        );
    }

    return (
        <div className="space-y-4 animate-fade-slide-up">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors">
                    <ArrowLeft size={22} className="text-white" />
                </button>
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-white">Recent Visitors</h1>
                    <p className="text-sm text-slate-400">{liveCount} online now</p>
                </div>
                <button onClick={fetchVisitors} className="p-2 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors">
                    <RefreshCw size={20} className="text-slate-400" />
                </button>
            </div>

            {/* Live Indicator */}
            <div className="flex items-center gap-2 px-4 py-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                </span>
                <span className="text-sm font-medium text-emerald-400">
                    {liveCount} {liveCount === 1 ? 'visitor' : 'visitors'} active in last 3 minutes
                </span>
            </div>

            {/* Visitor List */}
            <div className="space-y-3">
                {visitors.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="w-20 h-20 mx-auto mb-4 pwa-card flex items-center justify-center">
                            <Users className="text-slate-500" size={36} />
                        </div>
                        <p className="text-white font-semibold mb-1">No live visitors</p>
                        <p className="text-slate-400 text-sm">Visitors will appear when they're active</p>
                    </div>
                ) : (
                    visitors.map((visitor, index) => (
                        <button
                            key={visitor.id}
                            onClick={() => navigate(`/m/visitor/${visitor.visitorId}`)}
                            className="w-full pwa-card-interactive p-4 text-left animate-fade-slide-up"
                            style={{ animationDelay: `${index * 15}ms` }}
                        >
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm">
                                        {getVisitorName(visitor).charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="font-semibold text-white text-sm">
                                            {getVisitorName(visitor)}
                                        </p>
                                        <div className="flex items-center gap-2 text-xs text-slate-400">
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
                                <span className="text-xs text-slate-500">{formatTimeAgo(visitor.lastActiveAt)}</span>
                            </div>

                            {/* Current Page */}
                            {visitor.currentPath && (
                                <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-indigo-500/10 rounded-lg">
                                    <Eye size={14} className="text-indigo-400" />
                                    <span className="text-sm text-slate-300 truncate flex-1">
                                        {visitor.currentPath}
                                    </span>
                                </div>
                            )}

                            {/* UTM Source */}
                            {visitor.utmSource && (
                                <div className="flex items-center gap-2 mt-2">
                                    <Globe size={12} className="text-slate-500" />
                                    <span className="text-xs text-slate-400">
                                        via {visitor.utmSource}
                                        {visitor.utmCampaign && ` • ${visitor.utmCampaign}`}
                                    </span>
                                </div>
                            )}

                            {/* Recent Events */}
                            {visitor.events && visitor.events.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/5">
                                    {visitor.events.slice(0, 5).map((event, idx) => {
                                        const eventConfig: Record<string, { label: string; color: string }> = {
                                            'add_to_cart': { label: '🛒 Added to Cart', color: 'bg-blue-500/20 text-blue-400' },
                                            'remove_from_cart': { label: '❌ Removed', color: 'bg-slate-500/20 text-slate-400' },
                                            'cart_view': { label: '🛒 Viewing Cart', color: 'bg-blue-500/15 text-blue-400' },
                                            'checkout_view': { label: '💳 At Checkout', color: 'bg-purple-500/20 text-purple-400' },
                                            'checkout_start': { label: '💳 Started Checkout', color: 'bg-purple-500/20 text-purple-400' },
                                            'checkout_success': { label: '✅ Completed Checkout', color: 'bg-emerald-500/20 text-emerald-400' },
                                            'purchase': { label: '💰 Purchased', color: 'bg-emerald-500/20 text-emerald-400' },
                                            'page_view': { label: '👁️ ' + (event.pageTitle || 'Page View'), color: 'bg-slate-500/15 text-slate-400' },
                                            'search': { label: '🔍 Searched', color: 'bg-amber-500/20 text-amber-400' },
                                        };
                                        const config = eventConfig[event.type] || { label: event.type, color: 'bg-slate-500/15 text-slate-400' };

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
