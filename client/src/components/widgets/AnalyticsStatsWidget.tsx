import React, { useEffect, useState } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Globe, Monitor, Smartphone, Tablet, Clock } from 'lucide-react';

interface StatsData {
    countries: { country: string; sessions: number }[];
    devices: { type: string; sessions: number }[];
    browsers: { name: string; sessions: number }[];
    totalSessions: number;
    avgSessionDuration: number;
}

interface AnalyticsStatsWidgetProps {
    days?: number;
}

export const AnalyticsStatsWidget: React.FC<AnalyticsStatsWidgetProps> = ({ days = 30 }) => {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [stats, setStats] = useState<StatsData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            if (!currentAccount || !token) return;
            try {
                const data = await api.get<StatsData>(`/api/tracking/stats?days=${days}`, token, currentAccount.id);
                setStats(data);
            } catch (error) {
                console.error('Failed to fetch stats:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, [currentAccount, token, days]);

    if (loading) {
        return <div className="p-4 text-sm text-gray-500">Loading stats...</div>;
    }

    if (!stats) {
        return <div className="p-4 text-sm text-gray-500">No data available</div>;
    }

    const formatDuration = (seconds: number) => {
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };

    const getDeviceIcon = (type: string) => {
        switch (type) {
            case 'mobile': return <Smartphone className="w-4 h-4" />;
            case 'tablet': return <Tablet className="w-4 h-4" />;
            default: return <Monitor className="w-4 h-4" />;
        }
    };

    return (
        <div className="p-4 space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 rounded-lg p-3">
                    <div className="text-xs text-blue-600 font-medium">Total Sessions</div>
                    <div className="text-2xl font-bold text-blue-700">{stats.totalSessions.toLocaleString()}</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-3">
                    <div className="text-xs text-purple-600 font-medium flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Avg Duration
                    </div>
                    <div className="text-2xl font-bold text-purple-700">{formatDuration(stats.avgSessionDuration)}</div>
                </div>
            </div>

            {/* Top Countries */}
            <div>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
                    <Globe className="w-3 h-3" /> Top Countries
                </div>
                <div className="space-y-1">
                    {stats.countries.slice(0, 5).map((c, i) => (
                        <div key={c.country} className="flex items-center justify-between text-sm">
                            <span className="text-gray-700">{c.country}</span>
                            <span className="text-gray-500">{c.sessions}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Devices */}
            <div>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Devices</div>
                <div className="flex gap-2">
                    {stats.devices.map(d => (
                        <div key={d.type} className="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-sm text-xs text-gray-600">
                            {getDeviceIcon(d.type)}
                            <span className="capitalize">{d.type}</span>
                            <span className="text-gray-400">({d.sessions})</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Top Browsers */}
            <div>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Browsers</div>
                <div className="flex flex-wrap gap-1">
                    {stats.browsers.slice(0, 5).map(b => (
                        <span key={b.name} className="px-2 py-0.5 bg-gray-100 rounded-sm text-xs text-gray-600">
                            {b.name} ({b.sessions})
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default AnalyticsStatsWidget;
