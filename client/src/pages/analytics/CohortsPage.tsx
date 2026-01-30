import React, { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { TrendingUp } from 'lucide-react';

interface CohortData {
    cohorts: {
        week: string;
        totalVisitors: number;
        retention: { week: number; count: number; rate: number }[];
    }[];
}

export const CohortsPage: React.FC = () => {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [data, setData] = useState<CohortData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            if (!currentAccount || !token) return;
            setLoading(true);
            try {
                const result = await api.get<CohortData>('/api/tracking/cohorts', token, currentAccount.id);
                setData(result);
            } catch (error) {
                Logger.error('Failed to fetch cohorts:', { error: error });
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [currentAccount, token]);

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (!data || !data.cohorts.length) {
        return <div className="p-6 text-gray-500">No cohort data available yet. Check back after a few weeks.</div>;
    }

    const getRetentionColor = (rate: number) => {
        if (rate >= 70) return 'bg-green-500 text-white';
        if (rate >= 50) return 'bg-green-400 text-white';
        if (rate >= 30) return 'bg-yellow-400 text-gray-900';
        if (rate >= 15) return 'bg-orange-400 text-white';
        return 'bg-red-400 text-white';
    };

    const formatWeek = (week: string) => {
        const date = new Date(week);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <TrendingUp className="w-6 h-6" />
                    Cohort Analysis
                </h1>
                <p className="text-sm text-gray-500 mt-1">Track visitor retention over time by signup week.</p>
            </div>

            <Card className="border-0 shadow-xs overflow-hidden">
                <CardHeader>
                    <CardTitle className="text-sm font-semibold">Retention Matrix</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="text-left px-4 py-3 font-medium text-gray-600">Cohort</th>
                                    <th className="text-center px-4 py-3 font-medium text-gray-600">Users</th>
                                    <th className="text-center px-4 py-3 font-medium text-gray-600">Week 0</th>
                                    <th className="text-center px-4 py-3 font-medium text-gray-600">Week 1</th>
                                    <th className="text-center px-4 py-3 font-medium text-gray-600">Week 2</th>
                                    <th className="text-center px-4 py-3 font-medium text-gray-600">Week 3</th>
                                    <th className="text-center px-4 py-3 font-medium text-gray-600">Week 4</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.cohorts.map((cohort, i) => (
                                    <tr key={cohort.week} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                                        <td className="px-4 py-3 font-medium text-gray-900">{formatWeek(cohort.week)}</td>
                                        <td className="text-center px-4 py-3 text-gray-600">{cohort.totalVisitors}</td>
                                        {[0, 1, 2, 3, 4].map(weekNum => {
                                            const retention = cohort.retention.find(r => r.week === weekNum);
                                            if (!retention) return <td key={weekNum} className="text-center px-4 py-3 text-gray-300">-</td>;
                                            return (
                                                <td key={weekNum} className="text-center px-2 py-2">
                                                    <span className={`inline-block px-3 py-1 rounded-md text-xs font-medium ${getRetentionColor(retention.rate)}`}>
                                                        {retention.rate}%
                                                    </span>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>Retention:</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500 rounded-sm"></span> 70%+</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-400 rounded-sm"></span> 50-69%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-400 rounded-sm"></span> 30-49%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-orange-400 rounded-sm"></span> 15-29%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400 rounded-sm"></span> &lt;15%</span>
            </div>
        </div>
    );
};

export default CohortsPage;
