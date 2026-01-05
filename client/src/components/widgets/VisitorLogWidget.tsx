
import React, { useEffect, useState } from 'react';
import { Users, Clock, MapPin, ExternalLink } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

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
    }
}

const VisitorLogWidget: React.FC = () => {
    const [visitors, setVisitors] = useState<VisitorSession[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchLog = async () => {
        try {
            const res = await fetch('/api/analytics/visitors/log?limit=20', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'x-account-id': localStorage.getItem('accountId') || ''
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
        const interval = setInterval(fetchLog, 15000); // 15s poll
        return () => clearInterval(interval);
    }, []);

    if (loading && visitors.length === 0) return <div className="p-4 text-xs text-gray-500">Loading log...</div>;

    return (
        <div className="h-full overflow-y-auto custom-scrollbar">
            {visitors.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <Users className="w-6 h-6 mb-2 opacity-50" />
                    <span className="text-xs">No recent visitors</span>
                </div>
            ) : (
                <div className="flex flex-col">
                    <div className="grid grid-cols-12 gap-2 p-2 bg-gray-50/50 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider sticky top-0 backdrop-blur-sm z-10">
                        <div className="col-span-4">Visitor</div>
                        <div className="col-span-3">Location</div>
                        <div className="col-span-3">Active</div>
                        <div className="col-span-2 text-right">Referrer</div>
                    </div>
                    {visitors.map(v => (
                        <div key={v.id} className="grid grid-cols-12 gap-2 p-2.5 border-b border-gray-50 hover:bg-gray-50/50 transition-colors text-xs items-center">
                            <div className="col-span-4 flex items-center gap-2 overflow-hidden">
                                <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
                                    <Users className="w-3 h-3" />
                                </div>
                                <div className="flex flex-col truncate">
                                    <span className="font-medium text-gray-700 truncate" title={v.email || v.visitorId}>
                                        {v.email || `Guest (${v.visitorId.slice(0, 4)})`}
                                    </span>
                                    <span className="text-[10px] text-gray-400 truncate" title={v.currentPath}>
                                        {v.currentPath}
                                    </span>
                                </div>
                            </div>
                            <div className="col-span-3 flex items-center gap-1 text-gray-500 truncate">
                                {v.country ? (
                                    <>
                                        <MapPin className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{v.city}, {v.country}</span>
                                    </>
                                ) : <span className="text-gray-300">-</span>}
                            </div>
                            <div className="col-span-3 flex items-center gap-1 text-gray-500">
                                <Clock className="w-3 h-3 shrink-0" />
                                <span>{formatDistanceToNow(new Date(v.lastActiveAt), { addSuffix: true })}</span>
                            </div>
                            <div className="col-span-2 text-right truncate text-gray-400" title={v.referrer}>
                                {v.referrer ? new URL(v.referrer).hostname.replace('www.', '') : 'Direct'}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default VisitorLogWidget;
