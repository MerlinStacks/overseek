import * as React from 'react';
import { Save, DollarSign, Users, TrendingUp, Globe, Activity, Percent } from 'lucide-react';
import { DIMENSION_OPTIONS, METRIC_OPTIONS, ReportDimension, ReportMetric } from '../../types/analytics';

interface ReportConfigPanelProps {
    dateRange: string;
    setDateRange: (range: string) => void;
    dimension: string;
    setDimension: (dim: string) => void;
    metrics: string[];
    setMetrics: (metrics: string[]) => void;
    isLoading: boolean;
    onGenerate: () => void;
    onSaveOpen: () => void;
}

/** Icon mapping for metric categories */
const METRIC_ICONS: Record<string, React.ReactNode> = {
    sales: <DollarSign size={14} />,
    orders: <Activity size={14} />,
    aov: <TrendingUp size={14} />,
    quantity: <Activity size={14} />,
    new_customers: <Users size={14} />,
    sessions: <Globe size={14} />,
    visitors: <Users size={14} />,
    page_views: <Globe size={14} />,
    conversion_rate: <Percent size={14} />
};

export function ReportConfigPanel({
    dateRange,
    setDateRange,
    dimension,
    setDimension,
    metrics,
    setMetrics,
    isLoading,
    onGenerate,
    onSaveOpen
}: ReportConfigPanelProps) {

    const toggleMetric = (m: string) => {
        if (metrics.includes(m)) {
            setMetrics(metrics.filter(x => x !== m));
        } else {
            setMetrics([...metrics, m]);
        }
    };

    // Group dimensions by category
    const timeDimensions = DIMENSION_OPTIONS.filter(d => d.category === 'time');
    const salesDimensions = DIMENSION_OPTIONS.filter(d => d.category === 'sales');
    const trafficDimensions = DIMENSION_OPTIONS.filter(d => d.category === 'traffic');

    // Group metrics by category
    const salesMetrics = METRIC_OPTIONS.filter(m => m.category === 'sales');
    const trafficMetrics = METRIC_OPTIONS.filter(m => m.category === 'traffic');
    const conversionMetrics = METRIC_OPTIONS.filter(m => m.category === 'conversion');

    return (
        <div className="w-full md:w-80 shrink-0 space-y-5 border-r border-gray-100 pr-6">
            <div className="animate-in fade-in slide-in-from-left-2 space-y-5">

                {/* Header */}
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-bold text-gray-900">
                        Report Builder
                    </h3>
                    <button
                        onClick={onSaveOpen}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-all"
                    >
                        <Save size={14} /> Save
                    </button>
                </div>

                {/* Time Range */}
                <div className="bg-white/60 backdrop-blur-xs rounded-xl p-4 border border-gray-100/60 shadow-xs">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Time Range
                    </label>
                    <select
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                        className="w-full bg-gray-50/80 border border-gray-200/80 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-hidden"
                    >
                        <option value="today">Today</option>
                        <option value="yesterday">Yesterday</option>
                        <option value="7d">Last 7 Days</option>
                        <option value="30d">Last 30 Days</option>
                        <option value="90d">Last 90 Days</option>
                        <option value="ytd">Year to Date</option>
                    </select>
                </div>

                {/* Group By Dimension */}
                <div className="bg-white/60 backdrop-blur-xs rounded-xl p-4 border border-gray-100/60 shadow-xs">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Group By
                    </label>
                    <select
                        value={dimension}
                        onChange={(e) => setDimension(e.target.value)}
                        className="w-full bg-gray-50/80 border border-gray-200/80 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-hidden"
                    >
                        <optgroup label="Time">
                            {timeDimensions.map(d => (
                                <option key={d.value} value={d.value}>{d.label}</option>
                            ))}
                        </optgroup>
                        <optgroup label="Sales">
                            {salesDimensions.map(d => (
                                <option key={d.value} value={d.value}>{d.label}</option>
                            ))}
                        </optgroup>
                        <optgroup label="Traffic">
                            {trafficDimensions.map(d => (
                                <option key={d.value} value={d.value}>{d.label}</option>
                            ))}
                        </optgroup>
                    </select>
                </div>

                {/* Metrics Selection */}
                <div className="bg-white/60 backdrop-blur-xs rounded-xl p-4 border border-gray-100/60 shadow-xs">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                        Metrics
                    </label>

                    {/* Sales Metrics */}
                    <div className="mb-3">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                            <DollarSign size={10} /> Sales
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                            {salesMetrics.map(m => (
                                <label
                                    key={m.value}
                                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer border text-sm transition-all ${metrics.includes(m.value)
                                        ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-xs'
                                        : 'hover:bg-gray-50 border-gray-100 text-gray-600'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={metrics.includes(m.value)}
                                        onChange={() => toggleMetric(m.value)}
                                        className="sr-only"
                                    />
                                    <span className="opacity-60">{METRIC_ICONS[m.value]}</span>
                                    <span className="font-medium text-xs">{m.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Traffic Metrics */}
                    <div className="mb-3">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                            <Globe size={10} /> Traffic
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                            {trafficMetrics.map(m => (
                                <label
                                    key={m.value}
                                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer border text-sm transition-all ${metrics.includes(m.value)
                                        ? 'bg-green-50 border-green-200 text-green-700 shadow-xs'
                                        : 'hover:bg-gray-50 border-gray-100 text-gray-600'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={metrics.includes(m.value)}
                                        onChange={() => toggleMetric(m.value)}
                                        className="sr-only"
                                    />
                                    <span className="opacity-60">{METRIC_ICONS[m.value]}</span>
                                    <span className="font-medium text-xs">{m.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Conversion Metrics */}
                    <div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                            <Percent size={10} /> Conversion
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                            {conversionMetrics.map(m => (
                                <label
                                    key={m.value}
                                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer border text-sm transition-all ${metrics.includes(m.value)
                                        ? 'bg-purple-50 border-purple-200 text-purple-700 shadow-xs'
                                        : 'hover:bg-gray-50 border-gray-100 text-gray-600'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={metrics.includes(m.value)}
                                        onChange={() => toggleMetric(m.value)}
                                        className="sr-only"
                                    />
                                    <span className="opacity-60">{METRIC_ICONS[m.value]}</span>
                                    <span className="font-medium text-xs">{m.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Generate Button */}
                <button
                    onClick={onGenerate}
                    disabled={isLoading || metrics.length === 0}
                    className="w-full bg-linear-to-r from-blue-600 to-blue-700 text-white py-3 rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-sm shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30"
                >
                    {isLoading ? (
                        <span className="flex items-center justify-center gap-2">
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Generating...
                        </span>
                    ) : 'Generate Report'}
                </button>
            </div>
        </div>
    );
}
