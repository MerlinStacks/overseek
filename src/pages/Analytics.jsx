import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from 'recharts';
import { BarChart2, PieChart as PieIcon, TrendingUp, Activity, ArrowUp, ArrowDown, Zap, Mail } from 'lucide-react';
import { useStats } from '../hooks/useStats';
import DateRangePicker from '../components/DateRangePicker';
import './Analytics.css';

const COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#ef4444'];

const Analytics = () => {
    const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'automations'
    const [dateRange, setDateRange] = useState({ label: 'Last 30 Days', days: 30 });
    const [compareMode, setCompareMode] = useState('none');

    // Fetch Stats
    const stats = useStats(dateRange, compareMode);

    // Destructure for easier access in the renamed variables the component expects
    const {
        totalSales = 0,
        totalProfit = 0,
        avgOrderValue = 0,
        comparison = {},
        showCompare = false,
        chartData: revenueData = [],
        statusDistribution: statusData = []
    } = stats || {};

    // Remap stats object to match what the component expects if it uses 'stats.revenueData' etc.
    // However, the component seems to use 'stats.revenueData'. 
    // Let's overwite the 'stats' variable from useStats with a clearer object or just patch the missing properties onto the result.
    // Actually, looking at the code, it uses 'stats.revenueData'. useStats returns 'chartData'.
    // So let's just alias it in the stats object we pass down or use.

    // Quick fix: mutated stats object or new object? useStats returns a new object.
    if (stats) {
        stats.revenueData = stats.chartData;
        stats.statusData = stats.statusDistribution;
    }

    // Automation Data
    const automations = useLiveQuery(() => db.automations.toArray()) || [];
    const automationStats = {
        totalSent: 0,
        avgOpenRate: 0,
        avgClickRate: 0,
        totalRevenue: 0
    };

    const AutomationAnalytics = () => (
        <div className="animate-fade-in">
            <div className="dashboard-grid" style={{ marginBottom: '2rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                <StatCard title="Active Flows" value={automations.filter(a => a.active).length} change={0} icon={Zap} color="139, 92, 246" />
                <StatCard title="Emails Sent" value="0" change={0} icon={Mail} color="59, 130, 246" />
                <StatCard title="Avg Open Rate" value="0%" change={0} icon={BarChart2} color="16, 185, 129" />
                <StatCard title="Attributed Revenue" value="$0" change={0} icon={TrendingUp} color="245, 158, 11" />
            </div>

            <div className="glass-panel">
                <h3 className="section-title mb-4">Flow Performance</h3>
                <table className="products-table">
                    <thead>
                        <tr>
                            <th>Automation Name</th>
                            <th>Status</th>
                            <th>Sent</th>
                            <th>Open Rate</th>
                            <th>Click Rate</th>
                            <th>Revenue</th>
                        </tr>
                    </thead>
                    <tbody>
                        {automations.map(aut => {
                            // Real stats not yet implemented
                            const sent = 0;
                            const open = 0;
                            const click = 0;
                            const rev = 0;

                            return (
                                <tr key={aut.id}>
                                    <td style={{ fontWeight: 500 }}>{aut.name}</td>
                                    <td>
                                        <span className={`status-badge ${aut.active ? 'success' : 'warning'}`}>
                                            {aut.active ? 'Active' : 'Paused'}
                                        </span>
                                    </td>
                                    <td>{sent.toLocaleString()}</td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ width: '60px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px' }}>
                                                <div style={{ width: `${open}%`, height: '100%', background: '#10b981', borderRadius: '2px' }}></div>
                                            </div>
                                            {open}%
                                        </div>
                                    </td>
                                    <td>{click}%</td>
                                    <td>${parseInt(rev).toLocaleString()}</td>
                                </tr>
                            );
                        })}
                        {automations.length === 0 && (
                            <tr><td colSpan={6} className="text-center p-8 text-muted">No automations found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <div className="analytics-page">
            <div className="products-header">
                <div className="header-content">
                    <div className="products-icon-wrapper" style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}>
                        <BarChart2 size={32} />
                    </div>
                    <div className="products-title">
                        <h2>Analytics</h2>
                        <p>Deep dive into your store performance.</p>
                    </div>
                </div>
                <div className="header-actions">
                    <div className="glass-toggle-group" style={{ marginRight: '1rem', display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '8px' }}>
                        <button
                            className={`toggle-btn ${activeTab === 'overview' ? 'active' : ''}`}
                            style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: activeTab === 'overview' ? 'rgba(255,255,255,0.1)' : 'transparent', color: activeTab === 'overview' ? 'white' : 'var(--text-muted)', cursor: 'pointer' }}
                            onClick={() => setActiveTab('overview')}
                        >
                            Overview
                        </button>
                        <button
                            className={`toggle-btn ${activeTab === 'automations' ? 'active' : ''}`}
                            style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: activeTab === 'automations' ? 'rgba(255,255,255,0.1)' : 'transparent', color: activeTab === 'automations' ? 'white' : 'var(--text-muted)', cursor: 'pointer' }}
                            onClick={() => setActiveTab('automations')}
                        >
                            Automations
                        </button>
                    </div>

                    <DateRangePicker
                        range={dateRange}
                        onChange={setDateRange}
                        compareMode={compareMode}
                        onCompareChange={setCompareMode}
                    />
                </div>
            </div>

            {activeTab === 'automations' ? <AutomationAnalytics /> : (
                <>
                    {/* Summary Cards */}
                    <div className="dashboard-grid" style={{ marginBottom: '2rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                        <StatCard
                            title="Total Sales"
                            value={formatCurrency(totalSales)}
                            change={comparison.salesChange}
                            icon={BarChart2}
                            color="99, 102, 241"
                        />
                        <StatCard
                            title="Net Profit"
                            value={formatCurrency(totalProfit)}
                            change={comparison.profitChange}
                            icon={TrendingUp}
                            color="16, 185, 129"
                        />
                        <StatCard
                            title="Avg Order Value"
                            value={formatCurrency(avgOrderValue)}
                            change={comparison.aovChange}
                            icon={Activity}
                            color="236, 72, 153"
                        />
                    </div>

                    <div className="analytics-grid">
                        {/* Revenue Trend */}
                        <div className="analytics-card full-width">
                            <h3 className="card-title">
                                <TrendingUp size={20} className="text-primary" />
                                {dateRange.label} Performance
                            </h3>
                            <div className="chart-wrapper" style={{ height: '350px', width: '100%' }}>
                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                    <LineChart data={stats.revenueData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                        <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                                        <YAxis stroke="#64748b" tickFormatter={(v) => `$${v}`} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                                            formatter={(value, name) => {
                                                if (name === 'sales') return [formatCurrency(value), 'Revenue'];
                                                if (name === 'prevSales') return [formatCurrency(value), 'Prev Revenue'];
                                                if (name === 'profit') return [formatCurrency(value), 'Profit'];
                                                return [value, name];
                                            }}
                                        />
                                        <Line type="monotone" dataKey="sales" name="sales" stroke="#6366f1" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                                        {showCompare && (
                                            <Line type="monotone" dataKey="prevSales" name="prevSales" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 4 }} />
                                        )}
                                        <Line type="monotone" dataKey="profit" name="profit" stroke="#10b981" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Order Status Distribution */}
                        <div className="analytics-card">
                            <h3 className="card-title">
                                <PieIcon size={20} className="text-secondary" />
                                Order Status Distribution
                            </h3>
                            <div className="chart-wrapper" style={{ height: '300px', width: '100%' }}>
                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                    <PieChart>
                                        <Pie
                                            data={stats.statusData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {stats.statusData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                                            itemStyle={{ color: '#fff' }}
                                        />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Sales Volume (Bar) */}
                        <div className="analytics-card">
                            <h3 className="card-title">
                                <Activity size={20} className="text-success" />
                                Traffic vs Sales
                            </h3>
                            <div className="chart-wrapper" style={{ height: '300px', width: '100%' }}>
                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                    <BarChart data={stats.revenueData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                        <XAxis dataKey="name" hide />
                                        <YAxis stroke="#64748b" />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                        />
                                        <Bar dataKey="sales" fill="#10b981" radius={[4, 4, 0, 0]} opacity={0.8} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};


const StatCard = ({ title, value, change, icon: Icon, color }) => {
    // Determine arrow and color based on change
    const isPositive = change >= 0;
    const arrowColor = isPositive ? 'text-green-400' : 'text-red-400';

    return (
        <div className="glass-panel stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
            <div className="glass-shine"></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                <div>
                    <h3 style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>{title}</h3>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>{value}</div>
                </div>
                <div style={{
                    padding: '10px',
                    borderRadius: '12px',
                    background: `rgba(${color}, 0.1)`,
                    color: `rgb(${color})`
                }}>
                    <Icon size={24} />
                </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem' }}>
                <span className={arrowColor} style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold' }}>
                    {isPositive ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                    {Math.abs(change)}%
                </span>
                <span style={{ color: 'var(--text-muted)' }}>vs previous period</span>
            </div>
        </div>
    );
};

const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(val);
};

export default Analytics;
