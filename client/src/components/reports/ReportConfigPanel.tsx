import React from 'react';
import { Save } from 'lucide-react';

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

    return (
        <div className="w-full md:w-1/3 space-y-4 border-r pr-6">
            <div className="animate-in fade-in slide-in-from-left-2 space-y-4">
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        Report Config
                    </h3>
                    <button
                        onClick={onSaveOpen}
                        className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-sm font-medium"
                    >
                        <Save size={16} /> Save
                    </button>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Time Range</label>
                    <select
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                        className="w-full border rounded-lg p-2"
                    >
                        <option value="today">Today</option>
                        <option value="7d">Last 7 Days</option>
                        <option value="30d">Last 30 Days</option>
                        <option value="90d">Last 90 Days</option>
                        <option value="ytd">Year to Date</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Group By</label>
                    <select
                        value={dimension}
                        onChange={(e) => setDimension(e.target.value)}
                        className="w-full border rounded-lg p-2"
                    >
                        <option value="day">Day</option>
                        <option value="month">Month</option>
                        <option value="product">Product</option>
                        <option value="category">Category</option>
                        <option value="customer">Customer</option>
                        <option value="customer_segment">Segment</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Metrics</label>
                    <div className="grid grid-cols-2 gap-2">
                        {['sales', 'orders', 'aov', 'quantity'].map(m => (
                            <label key={m} className={`flex items-center space-x-2 p-2 rounded cursor-pointer border ${metrics.includes(m) ? 'bg-blue-50 border-blue-200' : 'hover:bg-gray-50 border-transparent'}`}>
                                <input
                                    type="checkbox"
                                    checked={metrics.includes(m)}
                                    onChange={() => toggleMetric(m)}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="capitalize text-sm">{m}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <button
                    onClick={onGenerate}
                    disabled={isLoading || metrics.length === 0}
                    className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 font-medium"
                >
                    {isLoading ? 'Generating...' : 'Generate Report'}
                </button>
            </div>
        </div>
    );
}
