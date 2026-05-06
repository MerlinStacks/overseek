import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { api } from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Logger } from '../../utils/logger';
import { getDateRange } from '../../utils/dateUtils';
import { Monitor, Smartphone, Tablet, Target, Activity } from 'lucide-react';

interface DeviceData {
    device: string;
    sessions: number;
    conversions: number;
    conversionRate: number;
}

interface SourceData {
    source: string;
    sessions: number;
    conversions: number;
    conversionRate: number;
}

interface BounceRateData {
    overallBounceRate: number;
    byPage?: { page: string; bounceRate: number; sessions: number }[];
}

const deviceIcons: Record<string, React.ReactNode> = {
    desktop: <Monitor className="w-4 h-4" />,
    mobile: <Smartphone className="w-4 h-4" />,
    tablet: <Tablet className="w-4 h-4" />,
};

export const CROView: React.FC<{ dateRange: string }> = ({ dateRange }) => {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [deviceData, setDeviceData] = useState<DeviceData[]>([]);
    const [sourceData, setSourceData] = useState<SourceData[]>([]);
    const [bounceData, setBounceData] = useState<BounceRateData | null>(null);
    const [loading, setLoading] = useState(false);

    const fetchData = useCallback(async () => {
        if (!token || !currentAccount?.id) return;
        setLoading(true);
        try {
            const range = getDateRange(dateRange);
            const [devices, sources, bounce] = await Promise.all([
                api.get<DeviceData[]>(`/api/analytics/cro/device?startDate=${range.startDate}&endDate=${range.endDate}`, token, currentAccount.id),
                api.get<SourceData[]>(`/api/analytics/cro/source?startDate=${range.startDate}&endDate=${range.endDate}`, token, currentAccount.id),
                api.get<BounceRateData>(`/api/analytics/cro/bounce-rate?startDate=${range.startDate}&endDate=${range.endDate}`, token, currentAccount.id),
            ]);
            setDeviceData(devices || []);
            setSourceData(sources || []);
            setBounceData(bounce);
        } catch (e) {
            Logger.error('Failed to fetch CRO data:', { error: e });
        } finally {
            setLoading(false);
        }
    }, [dateRange, token, currentAccount?.id]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const maxDeviceRate = Math.max(...deviceData.map(d => d.conversionRate), 1);
    const maxSourceRate = Math.max(...sourceData.map(s => s.conversionRate), 1);

    return (
        <div className="space-y-6">
            {/* Bounce Rate Card */}
            <Card className="border-0 shadow-xs">
                <CardContent className="p-5">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl ${bounceData && bounceData.overallBounceRate > 60
                            ? 'bg-red-100 dark:bg-red-900/30'
                            : 'bg-amber-100 dark:bg-amber-900/30'
                            }`}>
                            <Activity className={`w-5 h-5 ${bounceData && bounceData.overallBounceRate > 60
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-amber-600 dark:text-amber-400'
                                }`} />
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 dark:text-slate-400">Bounce Rate</p>
                            <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                                {bounceData ? `${bounceData.overallBounceRate.toFixed(1)}%` : '—'}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Conversion Rate by Device */}
                <Card className="border-0 shadow-xs">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <Target className="w-4 h-4 text-indigo-500" />
                            Conversion Rate by Device
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                            </div>
                        ) : deviceData.length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-slate-400 italic">No device data yet</p>
                        ) : (
                            <div className="space-y-4">
                                {deviceData.map(item => (
                                    <div key={item.device}>
                                        <div className="flex items-center justify-between text-sm mb-1.5">
                                            <span className="flex items-center gap-2 text-gray-700 dark:text-slate-300 capitalize">
                                                {deviceIcons[item.device] || <Monitor className="w-4 h-4" />}
                                                {item.device}
                                            </span>
                                            <span className="font-medium text-gray-900 dark:text-slate-100">{item.conversionRate.toFixed(2)}%</span>
                                        </div>
                                        <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-2.5">
                                            <div
                                                className="bg-indigo-500 h-2.5 rounded-full transition-all"
                                                style={{ width: `${(item.conversionRate / maxDeviceRate) * 100}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between text-xs text-gray-400 dark:text-slate-500 mt-1">
                                            <span>{item.sessions.toLocaleString()} sessions</span>
                                            <span>{item.conversions.toLocaleString()} conversions</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Conversion Rate by Source */}
                <Card className="border-0 shadow-xs">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <Target className="w-4 h-4 text-green-500" />
                            Conversion Rate by Source
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                            </div>
                        ) : sourceData.length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-slate-400 italic">No source data yet</p>
                        ) : (
                            <div className="space-y-4">
                                {sourceData.map(item => (
                                    <div key={item.source}>
                                        <div className="flex items-center justify-between text-sm mb-1.5">
                                            <span className="text-gray-700 dark:text-slate-300 capitalize">{item.source}</span>
                                            <span className="font-medium text-gray-900 dark:text-slate-100">{item.conversionRate.toFixed(2)}%</span>
                                        </div>
                                        <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-2.5">
                                            <div
                                                className="bg-green-500 h-2.5 rounded-full transition-all"
                                                style={{ width: `${(item.conversionRate / maxSourceRate) * 100}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between text-xs text-gray-400 dark:text-slate-500 mt-1">
                                            <span>{item.sessions.toLocaleString()} sessions</span>
                                            <span>{item.conversions.toLocaleString()} conversions</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default CROView;
