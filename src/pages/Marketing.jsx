
import React, { useState, useEffect } from 'react';
import { useAccount } from '../context/AccountContext';
import { db } from '../db/db';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { TrendingUp, Target, DollarSign, MousePointer2, Megaphone, Lightbulb, ExternalLink } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';

const MarketingPage = () => {
    const { activeAccount } = useAccount();
    const [connectStatus, setConnectStatus] = useState({ meta: false, google: false });

    // Check connection status
    const integrations = useLiveQuery(() =>
        db.ad_integrations.where('account_id').equals(activeAccount?.id || 0).toArray(),
        [activeAccount?.id]
    );

    useEffect(() => {
        if (integrations) {
            setConnectStatus({
                meta: integrations.some(i => i.platform === 'meta' && i.enabled),
                google: integrations.some(i => i.platform === 'google' && i.enabled)
            });
        }
    }, [integrations]);

    // Mock Data for UI demonstration
    const data = [
        { name: 'Mon', spend: 400, revenue: 2400 },
        { name: 'Tue', spend: 300, revenue: 1398 },
        { name: 'Wed', spend: 200, revenue: 9800 },
        { name: 'Thu', spend: 278, revenue: 3908 },
        { name: 'Fri', spend: 189, revenue: 4800 },
        { name: 'Sat', spend: 239, revenue: 3800 },
        { name: 'Sun', spend: 349, revenue: 4300 },
    ];

    if (!connectStatus.meta && !connectStatus.google) {
        return (
            <div className="p-8 text-center animate-fade-in" style={{ maxWidth: '600px', margin: '0 auto', paddingTop: '100px' }}>
                <Megaphone size={64} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
                <h2>Connect Your Ad Platforms</h2>
                <p className="text-muted mb-6">
                    To see AI-driven insights and revenue tracking, please connect your Meta Ads or Google Ads account in Settings.
                </p>
                <a href="/settings" className="btn btn-primary">Go to Settings</a>
            </div>
        );
    }

    return (
        <div className="marketing-page animate-fade-in">
            <div className="page-header mb-6">
                <div>
                    <h1>Marketing Intelligence</h1>
                    <p className="text-muted">Real-time ad performance and AI optimization suggestions.</p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    {connectStatus.meta && <span className="status-badge success">Meta Active</span>}
                    {connectStatus.google && <span className="status-badge success">Google Active</span>}
                </div>
            </div>

            {/* KPI Grid */}
            <div className="analytics-stats-grid mb-6">
                <div className="premium-stat-card">
                    <div className="stat-icon-wrapper" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#6366f1' }}>
                        <DollarSign size={24} />
                    </div>
                    <h3>Total Ad Spend</h3>
                    <div className="stat-value large">$1,955</div>
                    <span className="stat-change-badge negative">Start</span>
                </div>
                <div className="premium-stat-card">
                    <div className="stat-icon-wrapper" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
                        <TrendingUp size={24} />
                    </div>
                    <h3>Total Revenue (ROAS 4.2)</h3>
                    <div className="stat-value large">$8,210</div>
                    <span className="stat-change-badge positive">+12%</span>
                </div>
                <div className="premium-stat-card">
                    <div className="stat-icon-wrapper" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
                        <MousePointer2 size={24} />
                    </div>
                    <h3>CTR (Click Through Rate)</h3>
                    <div className="stat-value large">1.8%</div>
                    <span className="stat-change-badge positive">+0.2%</span>
                </div>
            </div>

            {/* AI Suggestions Grid */}
            <h3 className="section-title mb-4 flex items-center gap-2">
                <Lightbulb size={20} className="text-yellow-400" />
                AI Optimization Suggestions
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="glass-panel p-6 border-l-4 border-yellow-500">
                    <div className="flex justify-between items-start mb-2">
                        <h4 className="m-0">Low Inventory Warning</h4>
                        <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded">Action Needed</span>
                    </div>
                    <p className="text-sm text-muted mb-4">
                        Campaign <strong>"Summer Sale 2025"</strong> is driving traffic to <strong>Striped T-Shirt</strong> which has only 5 units left.
                    </p>
                    <button className="btn btn-sm btn-secondary">Pause Ad Set</button>
                </div>

                <div className="glass-panel p-6 border-l-4 border-green-500">
                    <div className="flex justify-between items-start mb-2">
                        <h4 className="m-0">High Margin Opportunity</h4>
                        <span className="text-xs bg-green-500/20 text-green-500 px-2 py-1 rounded">Opportunity</span>
                    </div>
                    <p className="text-sm text-muted mb-4">
                        Product <strong>"Premium Leather Bag"</strong> has a high margin (60%) and positive reviews (4.8/5). Increase ad budget?
                    </p>
                    <button className="btn btn-sm btn-primary">Increase Budget by 20%</button>
                </div>
            </div>

            {/* Charts */}
            <div className="glass-panel p-6 h-80">
                <h3 className="mb-4">Ad Spend vs Revenue</h3>
                <ResponsiveContainer width="100%" height="90%">
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" stroke="#64748b" />
                        <YAxis stroke="#64748b" />
                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} />
                        <Line type="monotone" dataKey="spend" stroke="#ef4444" strokeWidth={2} name="Ad Spend" />
                        <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} name="Revenue" />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default MarketingPage;
