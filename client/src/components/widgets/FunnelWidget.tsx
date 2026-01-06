import React, { useEffect, useState } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { TrendingDown } from 'lucide-react';

interface FunnelData {
    stages: { name: string; count: number }[];
}

export const FunnelWidget: React.FC = () => {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [funnel, setFunnel] = useState<FunnelData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchFunnel = async () => {
            if (!currentAccount || !token) return;
            try {
                const data = await api.get<FunnelData>('/api/tracking/funnel', token, currentAccount.id);
                setFunnel(data);
            } catch (error) {
                console.error('Failed to fetch funnel:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchFunnel();
    }, [currentAccount, token]);

    if (loading) {
        return <div className="p-4 text-sm text-gray-500">Loading funnel...</div>;
    }

    if (!funnel || !funnel.stages.length) {
        return <div className="p-4 text-sm text-gray-500">No funnel data available</div>;
    }

    const maxCount = Math.max(...funnel.stages.map(s => s.count));

    return (
        <div className="p-4 space-y-3">
            {funnel.stages.map((stage, i) => {
                const prevCount = i > 0 ? funnel.stages[i - 1].count : stage.count;
                const dropRate = prevCount > 0 ? Math.round((1 - stage.count / prevCount) * 100) : 0;
                const widthPercent = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;

                return (
                    <div key={stage.name}>
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-700">{stage.name}</span>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-gray-900">{stage.count.toLocaleString()}</span>
                                {i > 0 && dropRate > 0 && (
                                    <span className="text-xs text-red-500 flex items-center gap-0.5">
                                        <TrendingDown className="w-3 h-3" />
                                        {dropRate}%
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-6">
                            <div
                                className={`h-6 rounded-full transition-all duration-500 ${i === 0 ? 'bg-blue-500' :
                                    i === 1 ? 'bg-yellow-500' :
                                        i === 2 ? 'bg-orange-500' :
                                            'bg-green-500'
                                    }`}
                                style={{ width: `${Math.max(widthPercent, 2)}%` }}
                            />
                        </div>
                    </div>
                );
            })}

            {/* Conversion Rate */}
            {funnel.stages.length >= 2 && funnel.stages[0].count > 0 && (
                <div className="pt-3 border-t border-gray-100 mt-4">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Overall Conversion Rate</span>
                        <span className="text-lg font-bold text-green-600">
                            {((funnel.stages[funnel.stages.length - 1].count / funnel.stages[0].count) * 100).toFixed(1)}%
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FunnelWidget;
