/**
 * VisitorLogWidget - Real-time visitor activity stream (Matomo-style)
 * Shows visitors with their recent actions as clickable icons
 */
import React, { useEffect, useState } from 'react';
import { Users, Clock, MapPin, FileText, Search, ShoppingCart, Eye, ExternalLink, User } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import VisitorProfileModal from '../analytics/VisitorProfileModal';

interface VisitorEvent {
    id: string;
    type: string;
    url?: string;
    pageTitle?: string;
    createdAt: string;
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
    _count?: {
        events: number;
    };
    events?: VisitorEvent[];
}

/** Returns an icon component based on event type */
function getEventIcon(type: string) {
    switch (type) {
        case 'pageview':
            return FileText;
        case 'search':
            return Search;
        case 'add_to_cart':
        case 'remove_from_cart':
        case 'checkout_start':
        case 'checkout_success':
            return ShoppingCart;
        case 'purchase':
            return ShoppingCart;
        default:
            return Eye;
    }
}

/** Returns tailwind classes for event icon based on type */
function getEventIconClasses(type: string) {
    switch (type) {
        case 'pageview':
            return 'bg-blue-50 text-blue-500 hover:bg-blue-100';
        case 'search':
            return 'bg-purple-50 text-purple-500 hover:bg-purple-100';
        case 'add_to_cart':
        case 'remove_from_cart':
        case 'checkout_start':
        case 'checkout_success':
            return 'bg-amber-50 text-amber-600 hover:bg-amber-100';
        case 'purchase':
            return 'bg-green-50 text-green-600 hover:bg-green-100';
        default:
            return 'bg-gray-50 text-gray-500 hover:bg-gray-100';
    }
}

const VisitorLogWidget: React.FC = () => {
    const [visitors, setVisitors] = useState<VisitorSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedVisitor, setSelectedVisitor] = useState<string | null>(null);

    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const fetchLog = async () => {
        if (!token || !currentAccount) return;

        try {
            const res = await fetch('/api/analytics/visitors/log?limit=15', {
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
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLog();
        const interval = setInterval(fetchLog, 15000);
        return () => clearInterval(interval);
    }, [token, currentAccount]);

    if (loading && visitors.length === 0) {
        return <div className="p-4 text-xs text-gray-500">Loading log...</div>;
    }

    return (
        <div className="h-full overflow-hidden flex flex-col bg-white rounded-xl border border-gray-100 shadow-sm">
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
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white flex items-center justify-center shrink-0 text-xs font-semibold shadow-sm">
                                            {v.email ? v.email.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
                                        </div>
                                        {/* Name & Location */}
                                        <div className="flex flex-col min-w-0">
                                            <span className="font-medium text-gray-800 text-sm truncate">
                                                {v.email || `Visitor ${v.visitorId.slice(0, 6)}`}
                                            </span>
                                            <div className="flex items-center gap-1 text-xs text-gray-400">
                                                {v.country && (
                                                    <>
                                                        <MapPin className="w-3 h-3" />
                                                        <span className="truncate">{v.city ? `${v.city}, ` : ''}{v.country}</span>
                                                        <span className="mx-1">•</span>
                                                    </>
                                                )}
                                                <Clock className="w-3 h-3" />
                                                <span>{formatDistanceToNowStrict(new Date(v.lastActiveAt))} ago</span>
                                            </div>
                                        </div>
                                    </div>
                                    {/* Actions count badge */}
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                            {v._count?.events || 0} actions
                                        </span>
                                        <ExternalLink className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                </div>

                                {/* Action Icons Row */}
                                {v.events && v.events.length > 0 && (
                                    <div className="flex items-center gap-1 pl-10 flex-wrap">
                                        {v.events.slice(0, 8).map((event, idx) => {
                                            const IconComponent = getEventIcon(event.type);
                                            const iconClasses = getEventIconClasses(event.type);
                                            const tooltip = event.pageTitle || event.url || event.type;

                                            return (
                                                <a
                                                    key={event.id}
                                                    href={event.url || '#'}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${iconClasses}`}
                                                    title={`${tooltip}\n${formatDistanceToNowStrict(new Date(event.createdAt))} ago`}
                                                >
                                                    <IconComponent className="w-3 h-3" />
                                                </a>
                                            );
                                        })}
                                        {v.events.length > 8 && (
                                            <span className="text-xs text-gray-400 ml-1">+{v.events.length - 8}</span>
                                        )}
                                    </div>
                                )}
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
