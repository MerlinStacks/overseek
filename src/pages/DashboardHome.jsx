import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DollarSign, ShoppingCart, TrendingUp, TrendingDown, Eye, ArrowRight, ExternalLink, Activity, Bot, Facebook, Twitter, Instagram, Linkedin, Youtube, Globe, Pin, Info, Zap } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useStats } from '../hooks/useStats';
import { fetchVisitorCount, fetchVisitorLog } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import DateRangePicker from '../components/DateRangePicker';
import './DashboardHome.css';

// Helper to detect AI Agents & Socials
const getVisitorIdentity = (visit) => {
    const ua = (visit.device_info?.ua || '').toLowerCase();
    const ref = (visit.referrer || '').toLowerCase();

    // AI Agents
    if (ua.includes('gptbot') || ua.includes('chatgpt')) return { type: 'AI', label: 'ChatGPT', icon: <Bot size={14} color="#10a37f" /> };
    if (ua.includes('claude') || ua.includes('anthropic')) return { type: 'AI', label: 'Claude', icon: <Bot size={14} color="#d97757" /> };
    if (ua.includes('google-extended')) return { type: 'AI', label: 'Gemini', icon: <Bot size={14} color="#4285f4" /> };
    if (ua.includes('perplexity')) return { type: 'AI', label: 'Perplexity', icon: <Bot size={14} color="#22b8cf" /> };

    // Social Networks
    if (ref.includes('facebook')) return { type: 'Social', label: 'Facebook', icon: <Facebook size={14} color="#1877f2" /> };
    if (ref.includes('twitter') || ref.includes('x.com')) return { type: 'Social', label: 'Twitter', icon: <Twitter size={14} color="#1da1f2" /> };
    if (ref.includes('instagram')) return { type: 'Social', label: 'Instagram', icon: <Instagram size={14} color="#e4405f" /> };
    if (ref.includes('linkedin')) return { type: 'Social', label: 'LinkedIn', icon: <Linkedin size={14} color="#0a66c2" /> };

    return null;
};

// Portal Tooltip Component
const PortalTooltip = ({ children, coords, visible }) => {
    if (!visible || !coords) return null;
    return createPortal(
        <div style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
            pointerEvents: 'none',
            background: '#1e293b',
            color: '#f8fafc',
            padding: '8px',
            borderRadius: '4px',
            fontSize: '0.7rem',
            whiteSpace: 'pre-wrap',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            border: '1px solid rgba(255,255,255,0.1)',
            marginBottom: '8px'
        }}>
            {children}
        </div>,
        document.body
    );
};

const InfoWithTooltip = ({ visit }) => {
    const [coords, setCoords] = useState(null);
    const [visible, setVisible] = useState(false);
    const iconRef = useRef(null);

    const handleEnter = () => {
        if (iconRef.current) {
            const rect = iconRef.current.getBoundingClientRect();
            setCoords({ top: rect.top, left: rect.left + rect.width / 2 });
            setVisible(true);
        }
    };

    return (
        <>
            <div ref={iconRef} onMouseEnter={handleEnter} onMouseLeave={() => setVisible(false)} style={{ display: 'flex', alignItems: 'center' }}>
                <Info size={12} color="#64748b" style={{ cursor: 'help' }} />
            </div>
            <PortalTooltip visible={visible} coords={coords}>
                <div><strong>IP:</strong> {visit.ip}</div>
                <div><strong>ID:</strong> {visit.visit_id}</div>
                <div style={{ marginTop: '4px', wordBreak: 'break-all', maxWidth: '250px' }}><strong>UA:</strong> {visit.device_info?.ua || 'N/A'}</div>
            </PortalTooltip>
        </>
    );
};

const StatCard = ({ title, value, trend, icon: Icon, color, loading }) => {
    const isNegative = trend && typeof trend === 'string' && trend.includes('-');
    const TrendIcon = isNegative ? TrendingDown : TrendingUp;
    const trendClass = isNegative ? 'stat-trend trend-down' : 'stat-trend trend-up';

    return (
        <div className="glass-card stat-card">
            {loading ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                        <div className="skeleton" style={{ height: '14px', width: '60%', marginBottom: '10px' }}></div>
                        <div className="skeleton" style={{ height: '32px', width: '80%' }}></div>
                    </div>
                    <div className="skeleton" style={{ height: '16px', width: '40%' }}></div>
                </div>
            ) : (
                <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h3 className="stat-label">{title}</h3>
                            <p className="stat-value">{value}</p>
                        </div>
                        <div style={{
                            padding: '10px',
                            borderRadius: '10px',
                            background: `rgba(${color}, 0.1)`,
                            color: `rgb(${color})`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <Icon size={24} />
                        </div>
                    </div>
                    <div className={trendClass}>
                        <TrendIcon size={16} />
                        <span>{trend}</span>
                    </div>
                </>
            )}
        </div>
    );
};

const DashboardHome = () => {
    const [dateRange, setDateRange] = useState({ label: 'Today', days: 1, type: 'today' });
    const [compareMode, setCompareMode] = useState('period');

    const {
        totalSales,
        avgOrderValue,
        chartData,
        topProducts,
        comparison,
        showCompare,
        loading
    } = useStats(dateRange, compareMode);

    const { settings } = useSettings();
    const [visitorCount, setVisitorCount] = useState(0);
    const [visitorLogs, setVisitorLogs] = useState([]);
    const [locations, setLocations] = useState({});

    const allAutomations = useLiveQuery(() => db.automations.toArray()) || [];
    const activeAutomations = allAutomations.filter(a => a.active === true || a.active === 'true').length;

    useEffect(() => {
        const getData = async () => {
            if (settings.storeUrl && settings.consumerKey) {
                try {
                    const [countData, logsData] = await Promise.all([
                        fetchVisitorCount(settings),
                        fetchVisitorLog(settings)
                    ]);
                    if (Array.isArray(logsData)) {
                        const threeMinsAgo = new Date(Date.now() - 3 * 60 * 1000);
                        const activeVisitors = logsData.filter(v => {
                            const lastActive = new Date(v.last_activity.replace(' ', 'T'));
                            return lastActive > threeMinsAgo;
                        });

                        setVisitorCount(activeVisitors.length);
                        setVisitorLogs(activeVisitors.slice(0, 10));

                        activeVisitors.forEach(v => {
                            if (v.ip && !locations[v.ip]) resolveLocation(v.ip);
                        });
                    }
                } catch (err) {
                    // console.error("Failed to fetch dashboard data", err);
                }
            }
        };
        getData();
        const interval = setInterval(getData, 5000);
        return () => clearInterval(interval);
    }, [settings]);

    const resolveLocation = async (ip) => {
        if (locations[ip]) return;
        const cachedStr = localStorage.getItem('geo_cache');
        const cache = cachedStr ? JSON.parse(cachedStr) : {};

        if (cache[ip]) {
            setLocations(prev => ({ ...prev, [ip]: cache[ip] }));
            return;
        }

        setLocations(prev => ({ ...prev, [ip]: { pending: true } }));

        const saveToCache = (data) => {
            const currentCache = JSON.parse(localStorage.getItem('geo_cache') || '{}');
            currentCache[ip] = data;
            localStorage.setItem('geo_cache', JSON.stringify(currentCache));
            setLocations(prev => ({ ...prev, [ip]: data }));
        };

        try {
            const res = await fetch(`https://ipwho.is/${ip}`);
            if (res.ok) {
                const data = await res.json();
                if (data.success !== false) {
                    saveToCache({ country: data.country, code: data.country_code });
                    return;
                }
            }
            saveToCache({ country: 'Unknown', code: 'UN', failed: true });
        } catch (e) {
            saveToCache({ country: 'Unknown', code: 'UN', failed: true });
        }
    };

    const getFlag = (ip) => {
        const loc = locations[ip];
        if (!loc || !loc.code || loc.code === 'UN') return null;
        return loc.code.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
    };

    const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    const formatTrend = (val) => (val === undefined || !showCompare) ? 'No Data' : `${val >= 0 ? '+' : ''}${val.toFixed(1)}%`;

    return (
        <div className="page-container">
            <div className="page-header">
                <div className="page-title">
                    <h1>Dashboard Overview</h1>
                    <p>Real-time analytics and insights.</p>
                </div>
                <div className="page-actions">
                    <DateRangePicker
                        range={dateRange}
                        onChange={setDateRange}
                        compareMode={compareMode}
                        onCompareChange={setCompareMode}
                    />
                </div>
            </div>

            {/* Top Stats Grid */}
            <div className="dashboard-stats-grid">
                <StatCard title="Live Visitors" value={visitorCount} trend="Real-time" icon={Eye} color="16, 185, 129" />
                <StatCard title="Total Sales" value={formatCurrency(totalSales)} trend={formatTrend(comparison?.salesChange)} icon={DollarSign} color="99, 102, 241" loading={loading} />
                <StatCard title="Avg. Order Value" value={formatCurrency(avgOrderValue)} trend={formatTrend(comparison?.aovChange)} icon={TrendingUp} color="245, 158, 11" loading={loading} />
                <StatCard title="Active Flows" value={activeAutomations} trend="Operating" icon={Zap} color="139, 92, 246" />
            </div>

            {/* Main Content Grid */}
            <div className="dashboard-main-grid">
                {/* Revenue Chart */}
                <div className="glass-panel" style={{ padding: 'var(--spacing-md)', minHeight: '400px', display: 'flex', flexDirection: 'column', width: '100%' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '1rem', color: 'var(--text-main)' }}>Revenue Overview</h3>
                    <div style={{ flex: 1, minHeight: 0, position: 'relative', width: '100%', overflow: 'hidden' }}>
                        {loading ? (
                            <div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: '12px' }}></div>
                        ) : (
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={chartData || []}>
                                        <defs>
                                            <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                        <XAxis dataKey="label" stroke="#64748b" interval="preserveStartEnd" />
                                        <YAxis stroke="#64748b" />
                                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} itemStyle={{ color: '#fff' }} />
                                        <Area type="monotone" dataKey="sales" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>
                </div>

                {/* Real-time Traffic Feed */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '400px', overflow: 'hidden' }}>
                    <div style={{ padding: 'var(--spacing-md)', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '8px', height: '8px', background: '#10b981', borderRadius: '50%', boxShadow: '0 0 8px #10b981' }}></div>
                            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 'bold' }}>Live Feed</h3>
                        </div>
                        <Link to="/visitors" className="btn-icon"><ArrowRight size={14} /></Link>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        {visitorLogs.length > 0 ? (
                            visitorLogs.map((visit) => (
                                <div key={visit.id} style={{
                                    padding: '12px 16px',
                                    borderBottom: '1px solid var(--border-glass)',
                                    display: 'flex', flexDirection: 'column', gap: '4px'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                                        <span style={{ color: 'var(--text-muted)' }}>
                                            {new Date(visit.last_activity.replace(' ', 'T')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        <div style={{ display: 'flex', gap: '6px' }}>
                                            {(() => {
                                                const id = getVisitorIdentity(visit);
                                                return id ? <span title={id.label}>{id.icon}</span> : null;
                                            })()}
                                            <span>{getFlag(visit.ip)}</span>
                                            <InfoWithTooltip visit={visit} />
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '0.8rem' }}>
                                        {visit.referrer ? (
                                            <span style={{ color: '#10b981' }}>{visit.referrer.replace(/https?:\/\//, '').split('/')[0]}</span>
                                        ) : <span style={{ color: 'var(--text-muted)' }}>Direct</span>}
                                        {visit.actions && visit.actions.length > 0 && (
                                            <div style={{ marginTop: '4px', color: 'var(--text-main)', opacity: 0.9, fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {(() => {
                                                    // Find the last page view or interesting action
                                                    const actions = [...visit.actions].reverse();
                                                    const page = actions.find(a => a.type === 'page_view');
                                                    const conversion = actions.find(a => a.type === 'order' || a.type === 'add_to_cart');

                                                    // Prioritize conversion if very recent, otherwise show page
                                                    const displayAction = conversion || page;

                                                    if (!displayAction) return 'Unknown Page';

                                                    if (displayAction.type === 'order') return `Placed Order ($${displayAction.total})`;
                                                    if (displayAction.type === 'add_to_cart') return `Added to Cart`;

                                                    return displayAction.title || (displayAction.url ? displayAction.url.replace(/https?:\/\/[^/]+/, '') : 'Page View');
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                <Activity size={24} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
                                <p>Waiting for traffic...</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom Section */}
            <div className="dashboard-bottom-grid">
                <div className="glass-panel" style={{ padding: 'var(--spacing-md)' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '1rem' }}>Quick Actions</h3>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <Link to="/products/new" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                            <ShoppingCart size={18} /> Add Product
                        </Link>
                        <Link to="/orders/new" className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>
                            <DollarSign size={18} /> New Order
                        </Link>
                    </div>
                </div>

                <div className="glass-panel" style={{ padding: 'var(--spacing-md)' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '1rem' }}>Top Performer</h3>
                    {topProducts?.[0] ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '10px', borderRadius: '8px' }}>
                                <TrendingUp size={24} color="#10b981" />
                            </div>
                            <div>
                                <div style={{ fontSize: '1rem', fontWeight: 'bold' }}>{topProducts[0].name}</div>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{topProducts[0].count} units sold</div>
                            </div>
                        </div>
                    ) : <p className="text-muted">No data available</p>}
                </div>
            </div>
        </div>
    );
};

export default DashboardHome;
