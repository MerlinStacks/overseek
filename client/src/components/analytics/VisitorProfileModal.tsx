
import React, { useEffect, useState } from 'react';
import { X, User, MapPin, Clock, Smartphone, Monitor, ShoppingBag, Search } from 'lucide-react';
import { format } from 'date-fns';

interface VisitorProfileModalProps {
    visitorId: string;
    accountId: string;
    onClose: () => void;
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
        wooCustomerId?: number;
    };
    customer?: any; // WooCustomer data if linked
    stats: {
        totalEvents: number;
        firstSeen?: { createdAt: string };
    };
    sessionEvents?: any[]; // We fetch recent events
}

const VisitorProfileModal: React.FC<VisitorProfileModalProps> = ({ visitorId, accountId, onClose }) => {
    const [data, setData] = useState<VisitorData | null>(null);
    const [loading, setLoading] = useState(true);
    const [events, setEvents] = useState<any[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch profile
                const res = await fetch(`/api/analytics/visitors/${visitorId}`, {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`,
                        'x-account-id': accountId
                    }
                });
                if (res.ok) {
                    const json = await res.json();
                    setData(json);

                    // The API returns events nested or we might need separate call.
                    // Implementation plan said: include events: { take: 100 }
                    if (json.session && json.session.events) {
                        setEvents(json.session.events);
                    }
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

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
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
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                        <X className="w-5 h-5 text-gray-500" />
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

                        {/* Main Content: Activity Feed */}
                        <div className="w-2/3 p-6 overflow-y-auto bg-white">
                            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Activity Stream</h3>

                            <div className="space-y-6 relative before:absolute before:left-2 before:top-2 before:bottom-0 before:w-0.5 before:bg-gray-100">
                                {events.map((e, i) => (
                                    <div key={e.id} className="relative pl-6">
                                        <div className={`absolute left-0 top-1 w-4 h-4 rounded-full border-2 border-white shadow-sm flex items-center justify-center 
                                            ${e.type.includes('cart') ? 'bg-amber-100' : e.type === 'purchase' ? 'bg-green-500' : 'bg-gray-200'}`}>
                                            {/* Dot */}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-xs text-gray-400 mb-0.5">
                                                {format(new Date(e.createdAt), 'MMM d, HH:mm:ss')} • {e.type}
                                            </span>
                                            <div className="text-sm text-gray-700">
                                                {e.type === 'pageview' ? (
                                                    <span className="font-medium">Viewed {e.pageTitle || e.url}</span>
                                                ) : e.type === 'search' ? (
                                                    <span className="flex items-center gap-1 font-medium text-purple-600">
                                                        <Search className="w-3 h-3" /> Searched "{e.payload?.term}"
                                                    </span>
                                                ) : e.type === 'add_to_cart' ? (
                                                    <span>Added items to cart <span className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded ml-1">{JSON.stringify(e.payload?.items)}</span></span>
                                                ) : (
                                                    <span>{JSON.stringify(e.payload)}</span>
                                                )}
                                            </div>
                                            {e.type === 'pageview' && (
                                                <a href={e.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline truncate block mt-0.5 max-w-md">
                                                    {e.url}
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {events.length === 0 && (
                                    <div className="text-sm text-gray-400 italic pl-6">No events recorded in this session.</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VisitorProfileModal;
