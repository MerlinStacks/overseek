
import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { Globe, LayoutDashboard, Link, FileText, MousePointer, LogOut, LogIn, History, Search, AlertTriangle } from 'lucide-react';
import { getDateRange } from '../utils/dateUtils';
import { LiveSession } from '../types/analytics';
import { VisitorsTable } from '../components/analytics/VisitorsTable';
import { ReportsTable } from '../components/analytics/ReportsTable';
import { AnalyticsOverview } from '../components/analytics/AnalyticsOverview';
import { UrlBuilder } from '../components/analytics/UrlBuilder';
import { RoadblocksView } from '../components/analytics/RoadblocksView';

// Sidebar Menu Items
const MENUS = [
    {
        title: 'Acquisition',
        items: [
            { id: 'overview', label: 'Overview', icon: LayoutDashboard },
            { id: 'realtime', label: 'Real-time Log', icon: History },
            { id: 'channels', label: 'Channels', icon: Globe },
            { id: 'campaigns', label: 'Campaigns', icon: MousePointer },
            { id: 'url-builder', label: 'URL Builder', icon: Link },
        ]
    },
    {
        title: 'Behaviour',
        items: [
            { id: 'pages', label: 'Pages', icon: FileText },
            { id: 'entry', label: 'Entry Pages', icon: LogIn },
            { id: 'exit', label: 'Exit Pages', icon: LogOut },
            { id: 'roadblocks', label: 'Roadblocks', icon: AlertTriangle },
            { id: 'search', label: 'Site Search', icon: Search },
        ]
    }
];


export function LiveAnalyticsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [activeView, setActiveView] = useState('overview');

    // Live Data (Shared)
    const [visitors, setVisitors] = useState<LiveSession[]>([]);
    const [carts, setCarts] = useState<LiveSession[]>([]);
    // const [loadingLive, setLoadingLive] = useState(true); // Unused for now, or use in UI?

    // Report Data (Generic)
    const [reportData, setReportData] = useState<any[]>([]);
    const [loadingReport, setLoadingReport] = useState(false);

    // Date Range (Simple for now: today, 7d, 30d) - Defaults to today
    const [dateRange, setDateRange] = useState('today');

    // Memoized fetch function for visibility polling
    const fetchLiveData = useCallback(async () => {
        if (!currentAccount || !token) return;
        try {
            const [vRes, cRes] = await Promise.all([
                fetch('/api/tracking/live', { headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount.id } }),
                fetch('/api/tracking/carts', { headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount.id } })
            ]);
            if (vRes.ok) setVisitors(await vRes.json());
            if (cRes.ok) setCarts(await cRes.json());
        } catch (e) {
            Logger.error('An error occurred', { error: e });
        }
    }, [currentAccount, token]);

    // Visibility-aware polling with tab coordination
    useVisibilityPolling(fetchLiveData, 5000, [fetchLiveData], 'live-analytics-page');

    useEffect(() => {
        // Fetch Report Data when view changes
        if (activeView !== 'overview' && activeView !== 'realtime' && activeView !== 'url-builder') {
            fetchReport(activeView);
        }
    }, [activeView, dateRange, currentAccount]);

    async function fetchReport(viewId: string) {
        setLoadingReport(true);
        try {
            // Determine endpoint
            let endpoint = '';
            if (viewId === 'channels') endpoint = '/api/analytics/acquisition/channels';
            if (viewId === 'campaigns') endpoint = '/api/analytics/acquisition/campaigns';
            if (viewId === 'pages') endpoint = '/api/analytics/behaviour/pages';
            if (viewId === 'search') endpoint = '/api/analytics/behaviour/search';
            if (viewId === 'entry') endpoint = '/api/analytics/behaviour/entry';
            if (viewId === 'exit') endpoint = '/api/analytics/behaviour/exit';

            // Use shared date utility for consistent timezone handling
            const range = getDateRange(dateRange as any);

            const res = await fetch(`${endpoint}?startDate=${range.startDate}&endDate=${range.endDate}`, {
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount!.id }
            });

            if (res.ok) {
                setReportData(await res.json());
            }
        } catch (e) { Logger.error('An error occurred', { error: e }); }
        finally { setLoadingReport(false); }
    }

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] -m-8 overflow-hidden bg-gray-50">
            {/* Horizontal Tabs Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4">
                <div className="flex items-center justify-between mb-4">
                    <h1 className="text-xl font-bold text-gray-900 capitalize">{activeView.replace('-', ' ')}</h1>

                    {/* Date Range Picker (Only for reports) */}
                    {activeView !== 'overview' && activeView !== 'realtime' && activeView !== 'url-builder' && (
                        <select
                            value={dateRange}
                            onChange={e => setDateRange(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                        >
                            <option value="today">Today</option>
                            <option value="yesterday">Yesterday</option>
                            <option value="7d">Last 7 Days</option>
                            <option value="30d">Last 30 Days</option>
                        </select>
                    )}
                </div>

                {/* Tabs */}
                <div className="flex flex-wrap gap-6">
                    {MENUS.map((menu, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mr-2">{menu.title}</span>
                            <div className="flex items-center gap-1">
                                {menu.items.map(item => (
                                    <button
                                        key={item.id}
                                        onClick={() => setActiveView(item.id)}
                                        className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${activeView === item.id
                                            ? 'bg-blue-50 text-blue-600'
                                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                            }`}
                                    >
                                        <item.icon size={16} />
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Content */}
            <main className="flex-1 overflow-auto p-8">
                {activeView === 'overview' && (
                    <AnalyticsOverview
                        visitors={visitors}
                        carts={carts}
                        setActiveView={setActiveView}
                    />
                )}
                {activeView === 'realtime' && (
                    <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                        <VisitorsTable data={visitors} />
                    </div>
                )}
                {activeView === 'url-builder' && <UrlBuilder />}
                {activeView === 'roadblocks' && <RoadblocksView dateRange={dateRange} />}

                {/* Render Generic Report Table for others */}
                {activeView !== 'overview' && activeView !== 'realtime' && activeView !== 'url-builder' && activeView !== 'roadblocks' && (
                    <ReportsTable
                        data={reportData}
                        loading={loadingReport}
                        activeView={activeView}
                    />
                )}
            </main>
        </div>
    );
}
