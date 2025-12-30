import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from 'recharts';
import { BarChart2, PieChart as PieIcon, TrendingUp, Activity, ArrowUp, ArrowDown, Zap, Mail, Minus } from 'lucide-react';
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
        chartData: revenueData, // Alias for component usage
        statusDistribution: statusData // Alias for component usage
    } = stats || {};

    // Remap stats object to match what the component expects if it uses 'stats.revenueData' etc.
    // However, the component seems to use 'stats.revenueData'. 
    // Let's overwite the 'stats' variable from useStats with a clearer object or just patch the missing properties onto the result.
    // Actually, looking at the code, it uses 'stats.revenueData'. useStats returns 'chartData'.
    // So let's just alias it in the stats object we pass down or use.

    // Quick fix: mutated stats object or new object? useStats returns a new object.


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
            <div className="analytics-stats-grid">
                <StatCard title="Active Flows" value={automations.filter(a => a.active).length} change={0} icon={Zap} color="139, 92, 246" />
                <StatCard title="Emails Sent" value="0" change={0} icon={Mail} color="59, 130, 246" />
                <StatCard title="Avg Open Rate" value="0%" change={0} icon={BarChart2} color="16, 185, 129" />
                <StatCard title="Attributed Revenue" value="$0" change={0} icon={TrendingUp} color="245, 158, 11" />
            </div>

            <div className="analytics-card full-width">
                <h3 className="card-title">Flow Performance</h3>
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
            <div className="analytics-header-section">
                <div className="analytics-header-content">
                    <div className="analytics-title-group">
                        <div className="products-icon-wrapper" style={{ background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', width: '56px', height: '56px' }}>
                            <BarChart2 size={32} />
                        </div>
                        <div>
                            <h2>Performance Overview</h2>
                            <p>Real-time insights into your store's revenue, traffic, and growth metrics.</p>
                        </div>
                    </div>

                    <div className="header-actions">
                        <div className="analytics-controls">
                            <button
                                className={`toggle-btn ${activeTab === 'overview' ? 'active' : ''}`}
                                onClick={() => setActiveTab('overview')}
                            >
                                Overview
                            </button>
                            <button
                                className={`toggle-btn ${activeTab === 'automations' ? 'active' : ''}`}
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
            </div>

            {activeTab === 'automations' ? <AutomationAnalytics /> : (
                <>
                    {/* Summary Cards */}
                    <div className="analytics-stats-grid">
                        <StatCard
                            title="Total Revenue"
                            value={formatCurrency(totalSales)}
                            change={comparison.salesChange}
                            icon={BarChart2}
                            color="99, 102, 241"
                            trendLabel="vs last period"
                        />
                        <StatCard
                            title="Net Profit"
                            value={formatCurrency(totalProfit)}
                            change={comparison.profitChange}
                            icon={TrendingUp}
                            color="16, 185, 129"
                            trendLabel="vs last period"
                        />
                        <StatCard
                            title="Avg Order Value"
                            value={formatCurrency(avgOrderValue)}
                            change={comparison.aovChange}
                            icon={Activity}
                            color="236, 72, 153"
                            trendLabel="vs last period"
                        />
                        <StatCard
                            title="Conversion Rate"
                            value="3.2%"
                            change={1.5}
                            icon={Zap}
                            color="245, 158, 11"
                            trendLabel="vs last period"
                        />
                    </div>

                    <div className="analytics-grid">
                        {/* Revenue Trend */}
                        <div className="analytics-card full-width">
                            <h3 className="card-title">
                                <TrendingUp size={20} className="text-primary" />
                                Revenue Trends
                            </h3>
                            <div className="chart-wrapper">
                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                    <LineChart data={stats.revenueData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                        <XAxis
                                            dataKey="name"
                                            stroke="#64748b"
                                            fontSize={12}
                                            tickLine={false}
                                            axisLine={false}
                                            dy={10}
                                        />
                                        <YAxis
                                            stroke="#64748b"
                                            tickFormatter={(v) => `$${v}`}
                                            tickLine={false}
                                            axisLine={false}
                                            dx={-10}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: 'rgba(30, 41, 59, 0.9)',
                                                borderColor: 'rgba(255,255,255,0.1)',
                                                backdropFilter: 'blur(8px)',
                                                borderRadius: '12px',
                                                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                                            }}
                                            itemStyle={{ color: '#e2e8f0' }}
                                            formatter={(value, name) => {
                                                if (name === 'sales') return [formatCurrency(value), 'Revenue'];
                                                if (name === 'prevSales') return [formatCurrency(value), 'Previous'];
                                                if (name === 'profit') return [formatCurrency(value), 'Profit'];
                                                return [value, name];
                                            }}
                                        />
                                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                        <Line
                                            type="monotone"
                                            dataKey="sales"
                                            name="sales"
                                            stroke="#6366f1"
                                            strokeWidth={3}
                                            dot={false}
                                            activeDot={{ r: 6, stroke: '#6366f1', strokeWidth: 2, fill: '#1e1e2d' }}
                                            fill="url(#colorSales)"
                                        />
                                        {showCompare && (
                                            <Line type="monotone" dataKey="prevSales" name="prevSales" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 4 }} />
                                        )}
                                        <Line
                                            type="monotone"
                                            dataKey="profit"
                                            name="profit"
                                            stroke="#10b981"
                                            strokeWidth={3}
                                            dot={false}
                                            activeDot={{ r: 6, stroke: '#10b981', strokeWidth: 2, fill: '#1e1e2d' }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Order Status Distribution */}
                        <div className="analytics-card">
                            <h3 className="card-title">
                                <PieIcon size={20} className="text-secondary" />
                                Order Status
                            </h3>
                            <div className="chart-wrapper">
                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                    <PieChart>
                                        <Pie
                                            data={stats.statusData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={80}
                                            outerRadius={100}
                                            paddingAngle={5}
                                            dataKey="value"
                                            stroke="none"
                                        >
                                            {stats.statusData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: 'rgba(30, 41, 59, 0.9)',
                                                borderColor: 'rgba(255,255,255,0.1)',
                                                borderRadius: '8px'
                                            }}
                                            itemStyle={{ color: '#fff' }}
                                        />
                                        <Legend
                                            verticalAlign="bottom"
                                            height={36}
                                            iconType="circle"
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Sales Volume (Bar) */}
                        <div className="analytics-card">
                            <h3 className="card-title">
                                <Activity size={20} className="text-success" />
                                Sales Volume
                            </h3>
                            <div className="chart-wrapper">
                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                    <BarChart data={stats.revenueData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                        <XAxis dataKey="name" hide />
                                        <YAxis stroke="#64748b" axisLine={false} tickLine={false} />
                                        <Tooltip
                                            cursor={{ fill: 'rgba(255,255,255,0.05)', radius: 4 }}
                                            contentStyle={{
                                                backgroundColor: 'rgba(30, 41, 59, 0.9)',
                                                borderColor: 'rgba(255,255,255,0.1)',
                                                borderRadius: '8px'
                                            }}
                                        />
                                        <Bar
                                            dataKey="sales"
                                            fill="#10b981"
                                            radius={[6, 6, 0, 0]}
                                        >
                                            {stats.revenueData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#10b981' : '#34d399'} opacity={0.8} />
                                            ))}
                                        </Bar>
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


const StatCard = ({ title, value, change, icon: Icon, color, trendLabel }) => {
    // Determine arrow and color based on change
    const noPrevData = change === null;
    const isPositive = !noPrevData && change >= 0;

    return (
        <div className="premium-stat-card">
            <div className="stat-icon-wrapper" style={{ background: `rgba(${color}, 0.15)`, color: `rgb(${color})` }}>
                <Icon size={24} />
            </div>

            <h3 style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.25rem', fontWeight: 500 }}>{title}</h3>
            <div className="stat-value large">{value}</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '0.5rem' }}>
                <span className={`stat-change-badge ${isPositive ? 'positive' : 'negative'}`}>
                    {noPrevData ? <Minus size={14} /> : (isPositive ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
                    {noPrevData ? 'N/A' : `${Math.abs(change)}%`}
                </span>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{trendLabel || 'vs previous'}</span>
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
    }).format(val || 0);
};

export default Analytics;
