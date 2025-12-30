import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Line } from 'recharts';
import { TrendingUp, Calendar, ArrowRight, DollarSign, Package } from 'lucide-react';
import { useStats } from '../hooks/useStats';
import { calculateForecast } from '../utils/forecasting';
import { useSettings } from '../context/SettingsContext';
import DateRangePicker from '../components/DateRangePicker';
import InventoryPlanning from './InventoryPlanning';
import './Forecasting.css'; // Import the styles

const Forecasting = () => {
    const [activeTab, setActiveTab] = useState('stock'); // Default to Stock Planning as per user request
    const [dateRange, setDateRange] = useState({ label: 'Last 90 Days', days: 90 }); // Default longer range for better trends
    const { chartData, totalSales, avgOrderValue } = useStats(dateRange);

    // Calculate Forecast
    const forecastData = useMemo(() => {
        if (!chartData || chartData.length === 0) return null;
        return calculateForecast(chartData, 30); // Forecast next 30 days
    }, [chartData]);

    // Merge Data for Chart
    const mergedData = useMemo(() => {
        if (!chartData || !forecastData) return [];

        // 1. Format Historical
        const historical = chartData.map(d => ({
            ...d,
            name: d.label || d.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), // Ensure name exists
            sales: d.sales,
            forecast: null // Gap for forecast line
        }));

        // 2. Connect the lines
        const lastHistorical = historical[historical.length - 1];

        const forecast = forecastData.forecastPoints.map((d, i) => ({
            ...d,
            // name is already set in forecasting.js
            sales: null,
            forecast: d.forecast
        }));

        // Match format of bridge point
        if (lastHistorical) {
            const bridgePoint = {
                ...lastHistorical,
                sales: null,
                forecast: lastHistorical.sales
            };
            forecast.unshift(bridgePoint);
        }

        return [...historical, ...forecast];
    }, [chartData, forecastData]);

    const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

    return (
        <div style={{ padding: 'var(--spacing-lg)' }}>

            {/* Header / Tabs */}
            <div className="inventory-header" style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {activeTab === 'revenue' ? <TrendingUp color="#6366f1" /> : <Package color="#6366f1" />}
                        {activeTab === 'revenue' ? 'Revenue Forecasting' : 'Stock Planning'}
                    </h2>
                    <p style={{ color: 'var(--text-muted)' }}>
                        {activeTab === 'revenue'
                            ? 'Predict future revenue based on historical trends.'
                            : 'Forecast stock reorders based on sales velocity and lead times.'
                        }
                    </p>
                </div>

                <div className="tabs-container" style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '8px', height: 'fit-content' }}>
                    <button
                        onClick={() => setActiveTab('stock')}
                        className={`btn ${activeTab === 'stock' ? 'btn-primary' : ''}`}
                        style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: activeTab === 'stock' ? '' : 'transparent', color: activeTab === 'stock' ? '#fff' : 'var(--text-muted)' }}
                    >
                        <Package size={16} style={{ marginRight: 6 }} /> Stock Reorder
                    </button>
                    <button
                        onClick={() => setActiveTab('revenue')}
                        className={`btn ${activeTab === 'revenue' ? 'btn-primary' : ''}`}
                        style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: activeTab === 'revenue' ? '' : 'transparent', color: activeTab === 'revenue' ? '#fff' : 'var(--text-muted)' }}
                    >
                        <TrendingUp size={16} style={{ marginRight: 6 }} /> Revenue
                    </button>
                </div>
            </div>

            {activeTab === 'stock' ? (
                <InventoryPlanning />
            ) : (
                <>
                    {/* Revenue Content */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '1rem' }}>
                        <div>
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginRight: '1rem' }}>Based on:</span>
                            <select
                                value={dateRange.days}
                                onChange={(e) => setDateRange({ label: 'Custom', days: parseInt(e.target.value) })}
                                style={{ padding: '8px', borderRadius: '8px', background: 'var(--bg-panel)', border: '1px solid var(--border-glass)', color: '#fff' }}
                            >
                                <option value="30">Last 30 Days</option>
                                <option value="60">Last 60 Days</option>
                                <option value="90">Last 90 Days</option>
                                <option value="180">Last 6 Months</option>
                            </select>
                        </div>
                    </div>

                    {!chartData ? <div className="p-8">Loading forecast data...</div> : (
                        <>
                            <div className="dashboard-grid">
                                <div className="glass-card stat-card">
                                    <div className="stat-header">
                                        <div>
                                            <h3 className="stat-title">Projected Revenue (Next 30 Days)</h3>
                                            <p className="stat-value">{forecastData ? formatCurrency(forecastData.expectedTotal) : '...'}</p>
                                        </div>
                                        <div className="icon-box" style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1' }}>
                                            <DollarSign size={24} />
                                        </div>
                                    </div>
                                </div>
                                <div className="glass-card stat-card">
                                    <div className="stat-header">
                                        <div>
                                            <h3 className="stat-title">Growth Trend</h3>
                                            <p className="stat-value" style={{ color: forecastData?.trend > 0 ? '#10b981' : '#ef4444' }}>
                                                {forecastData?.trend > 0 ? '+' : ''}{formatCurrency(forecastData?.trend || 0)} / day
                                            </p>
                                        </div>
                                        <div className="icon-box" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                                            <TrendingUp size={24} />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="glass-panel" style={{ padding: 'var(--spacing-md)', minHeight: '500px' }}>
                                <h3 className="section-title">Projection Chart</h3>
                                <div style={{ height: '400px', width: '100%' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={mergedData}>
                                            <defs>
                                                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                            <XAxis
                                                dataKey="name"
                                                stroke="#64748b"
                                                tick={{ fontSize: 12 }}
                                                minTickGap={30}
                                            />
                                            <YAxis
                                                stroke="#64748b"
                                                tick={{ fontSize: 12 }}
                                                tickFormatter={(val) => `$${val}`}
                                            />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                                                itemStyle={{ color: '#fff' }}
                                                formatter={(value, name) => [formatCurrency(value), name === 'sales' ? 'Actual Revenue' : 'Projected Revenue']}
                                                labelFormatter={(label) => `Date: ${label}`}
                                            />

                                            <Area
                                                type="monotone"
                                                dataKey="sales"
                                                stroke="#6366f1"
                                                fill="url(#colorSales)"
                                                strokeWidth={2}
                                                name="sales"
                                            />

                                            <Line
                                                type="monotone"
                                                dataKey="forecast"
                                                stroke="#10b981"
                                                strokeWidth={2}
                                                strokeDasharray="5 5"
                                                dot={false}
                                                name="forecast"
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="forecast"
                                                stroke="none"
                                                fill="url(#colorForecast)"
                                            />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </>)}
                </>
            )}
        </div>
    );
};

export default Forecasting;
