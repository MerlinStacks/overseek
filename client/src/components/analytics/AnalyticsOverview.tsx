import { LiveSession } from '../../types/analytics';
import { VisitorsTable } from './VisitorsTable';

interface AnalyticsOverviewProps {
    visitors: LiveSession[];
    carts: LiveSession[];
    setActiveView: (view: string) => void;
}

export const AnalyticsOverview = ({ visitors, carts, setActiveView }: AnalyticsOverviewProps) => (
    <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" /> Live Visitors
                </h3>
                <div className="text-4xl font-bold text-gray-900 mb-2">{visitors.length}</div>
                <p className="text-sm text-gray-500">Active in last 30 minutes</p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <div className="w-2 h-2 bg-orange-500 rounded-full" /> Active Carts
                </h3>
                <div className="text-4xl font-bold text-gray-900 mb-2">{carts.length}</div>
                <p className="text-sm text-gray-500">Users with items in cart</p>
            </div>
        </div>

        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                <h3 className="font-semibold text-gray-900">Real-time Log</h3>
                <button onClick={() => setActiveView('realtime')} className="text-sm text-blue-600 hover:text-blue-800">View All</button>
            </div>
            <VisitorsTable data={visitors.slice(0, 5)} />
        </div>
    </div>
);
