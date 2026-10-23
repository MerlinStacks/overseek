import * as React from 'react';
import { Save, DollarSign, Users, TrendingUp, Globe, Activity, Percent } from 'lucide-react';
import { DIMENSION_OPTIONS, METRIC_OPTIONS } from '../../types/analytics';

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
    const id = React.useId();

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
        <fieldset disabled={isLoading} className="w-full md:w-80 shrink-0 space-y-5 border-r border-slate-200 dark:border-slate-700 pr-6 text-slate-900 dark:text-slate-100">
            <div className="animate-in fade-in slide-in-from-left-2 space-y-5">

                {/* Header */}
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">
                        Report Builder
                    </h3>
                    <button
                        type="button" disabled={!metrics.length}
                        onClick={onSaveOpen}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--brand-text)] hover:bg-[var(--brand-subtle)] rounded-lg transition-colors"
                    >
                        <Save size={14} /> Save
                    </button>
                </div>

                {/* Time Range */}
                    <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                    <label htmlFor={`${id}-range`} className="block text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                        Time Range
                    </label>
                    <select
                        id={`${id}-range`}
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-[var(--brand-border)] focus:border-[var(--primary-color)] transition-colors outline-hidden"
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
                    <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                    <label htmlFor={`${id}-dimension`} className="block text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                        Group By
                    </label>
                    <select
                        id={`${id}-dimension`}
                        value={dimension}
                        onChange={(e) => setDimension(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-[var(--brand-border)] focus:border-[var(--primary-color)] transition-colors outline-hidden"
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
                    <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
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
                                            ? 'bg-[var(--brand-subtle)] border-[var(--brand-border)] text-[var(--brand-text)]'
                                        : 'hover:bg-gray-50 border-gray-100 text-gray-600'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={metrics.includes(m.value)}
                                        onChange={() => toggleMetric(m.value)}
                                            className="w-4 h-4 accent-[var(--primary-color)] focus-visible:outline-2 focus-visible:outline-[var(--focus-color)]"
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
                                            className="w-4 h-4 accent-[var(--primary-color)] focus-visible:outline-2 focus-visible:outline-[var(--focus-color)]"
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
                                            ? 'bg-[var(--brand-subtle)] border-[var(--brand-border)] text-[var(--brand-text)]'
                                        : 'hover:bg-gray-50 border-gray-100 text-gray-600'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={metrics.includes(m.value)}
                                        onChange={() => toggleMetric(m.value)}
                                            className="w-4 h-4 accent-[var(--primary-color)] focus-visible:outline-2 focus-visible:outline-[var(--focus-color)]"
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
                    type="button"
                    onClick={onGenerate}
                    disabled={isLoading || metrics.length === 0}
                        className="w-full bg-[var(--primary-color)] text-[var(--primary-foreground)] py-3 rounded-lg hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-sm focus-visible:outline-[var(--focus-color)]"
                >
                    {isLoading ? (
                        <span className="flex items-center justify-center gap-2">
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Generating...
                        </span>
                    ) : 'Generate Report'}
                </button>
            </div>
        </fieldset>
    );
}
