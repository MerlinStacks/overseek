import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import Pagination from '../components/Pagination';
import { fetchVisitorLog, fetchSystemStatus } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { Activity, ShoppingCart, CheckCircle, Eye, RefreshCw, Smartphone, Monitor, Globe, Clock, User, AlertTriangle, Database, X, History, MapPin, Calendar, Layout, FileText, DollarSign, Bot, Facebook, Twitter, Instagram, Linkedin, Youtube, Pin } from 'lucide-react';
import { toast } from 'sonner';
import DateRangePicker from '../components/DateRangePicker';
import './VisitorLog.css';

// Helper to detect AI Agents & Socials
const getVisitorIdentity = (visit) => {
    const ua = (visit.device_info?.ua || '').toLowerCase();
    const ref = (visit.referrer || '').toLowerCase();

    // AI Agents (High Priority)
    if (ua.includes('gptbot') || ua.includes('chatgpt')) return { type: 'AI', label: 'ChatGPT', icon: <Bot size={14} color="#10a37f" /> };
    if (ua.includes('claude') || ua.includes('anthropic')) return { type: 'AI', label: 'Claude', icon: <Bot size={14} color="#d97757" /> };
    if (ua.includes('google-extended')) return { type: 'AI', label: 'Gemini', icon: <Bot size={14} color="#4285f4" /> };
    if (ua.includes('perplexity')) return { type: 'AI', label: 'Perplexity', icon: <Bot size={14} color="#22b8cf" /> };
    if (ua.includes('bot') || ua.includes('crawl') || ua.includes('spider')) return { type: 'Bot', label: 'Bot', icon: <Bot size={14} color="#94a3b8" /> };

    // Social Networks
    if (ref.includes('facebook') || ref.includes('fb.com')) return { type: 'Social', label: 'Facebook', icon: <Facebook size={14} color="#1877f2" /> };
    if (ref.includes('twitter') || ref.includes('t.co') || ref.includes('x.com')) return { type: 'Social', label: 'Twitter', icon: <Twitter size={14} color="#1da1f2" /> };
    if (ref.includes('instagram')) return { type: 'Social', label: 'Instagram', icon: <Instagram size={14} color="#e4405f" /> };
    if (ref.includes('linkedin')) return { type: 'Social', label: 'LinkedIn', icon: <Linkedin size={14} color="#0a66c2" /> };
    if (ref.includes('youtube')) return { type: 'Social', label: 'YouTube', icon: <Youtube size={14} color="#ff0000" /> };
    if (ref.includes('pinterest')) return { type: 'Social', label: 'Pinterest', icon: <Pin size={14} color="#bd081c" /> };
    if (ref.includes('reddit')) return { type: 'Social', label: 'Reddit', icon: <Globe size={14} color="#ff4500" /> };

    return null;
};

const VisitorProfileModal = ({ visitorId, allVisits, isOpen, onClose }) => {
    if (!isOpen || !visitorId) return null;

    const getHost = (url) => {
        try { return new URL(url).hostname; } catch (e) { return 'Direct Entry'; }
    };

    // Robust ID resolver
    const getVisitorID = (v) => v.visitor_id || v.cookie_id || v.ip;

    // Filter all visits for this user
    const userVisits = allVisits.filter(v => getVisitorID(v) === visitorId).sort((a, b) => b.last_activity - a.last_activity);

    // Validate if any visits found (if ID is weak/broken)
    if (!userVisits.length) return null;

    // Aggregates
    const firstVisit = userVisits[userVisits.length - 1]; // Oldest
    const lastVisit = userVisits[0]; // Newest
    const totalVisits = userVisits.length;

    const resolveDuration = (actions) => {
        if (!actions || actions.length < 2) return 0;
        return actions[actions.length - 1].time - actions[0].time;
    };

    const totalDuration = userVisits.reduce((acc, v) => acc + resolveDuration(v.actions), 0);
    const totalPages = userVisits.reduce((acc, v) => acc + (v.actions?.filter(a => a.type === 'page_view').length || 0), 0);
    const totalGoals = 0;

    const formatDuration = (sec) => {
        if (sec < 60) return `${sec}s`;
        return `${Math.floor(sec / 60)} min ${sec % 60}s`;
    };

    const formatDate = (dateStr) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + ' ' + d.toLocaleTimeString();
    };

    const getFlagEmoji = (code) => {
        if (!code) return '🏳️';
        return code.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.8)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(5px)'
        }} onClick={onClose}>
            <div style={{
                width: '900px', height: '90vh', background: '#1e293b',
                borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden'
            }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{
                    padding: '1rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'rgba(0,0,0,0.2)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <User size={20} />
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Visitor Profile</h2>
                    </div>
                    <button onClick={onClose} className="btn-icon"><X size={20} /></button>
                </div>

                {/* Content Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', flex: 1, overflow: 'hidden' }}>

                    {/* Left Column: Profile Summary */}
                    <div style={{ padding: '2rem', borderRight: '1px solid rgba(255,255,255,0.1)', overflowY: 'auto', background: 'rgba(0,0,0,0.1)' }}>
                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                            <div style={{
                                width: '64px', height: '64px', background: 'rgba(255,255,255,0.1)', borderRadius: '8px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                <User size={32} color="rgba(255,255,255,0.5)" />
                            </div>
                            <div>
                                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Visitor ID</div>
                                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{visitorId}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                                    {lastVisit?.location?.code && <span style={{ fontSize: '1.2rem' }}>{getFlagEmoji(lastVisit.location.code)}</span>}
                                    <span style={{ fontSize: '0.9rem' }}>{lastVisit?.location?.city || 'Unknown Location'}</span>
                                </div>
                            </div>
                        </div>

                        <h3 className="section-title" style={{ marginBottom: '10px', fontSize: '1.1rem' }}>Summary</h3>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                            Spent a total of <strong>{formatDuration(totalDuration)}</strong> on the website, and viewed <strong>{totalPages} pages</strong> in <strong>{totalVisits} visits</strong>.
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '2rem' }}>
                            <div>
                                <h4 style={{ fontSize: '0.9rem', marginBottom: '8px' }}>First visit</h4>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(firstVisit.last_activity).toLocaleDateString()}</div>
                                <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>from {getHost(firstVisit.referrer)}</div>
                            </div>
                            <div>
                                <h4 style={{ fontSize: '0.9rem', marginBottom: '8px' }}>Last visit</h4>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(lastVisit.last_activity).toLocaleDateString()}</div>
                                <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>from {getHost(lastVisit.referrer)}</div>
                            </div>
                        </div>

                        <div style={{ marginTop: '2rem' }}>
                            <h4 style={{ fontSize: '0.9rem', marginBottom: '8px' }}>Devices</h4>
                            <div style={{ fontSize: '0.85rem', display: 'flex', gap: '6px', color: 'var(--text-muted)' }}>
                                <Smartphone size={14} />
                                {lastVisit.device_info?.is_mobile ? 'Smartphone' : 'Desktop'}
                                ({lastVisit.device_info?.amount || totalVisits}x)
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Visit History */}
                    <div style={{ overflowY: 'auto', padding: '0' }}>
                        {userVisits.map((visit, idx) => {
                            const visitNum = userVisits.length - idx;
                            const duration = resolveDuration(visit.actions);
                            return (
                                <div key={visit.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <div style={{ padding: '1rem 1.5rem', background: 'rgba(255,255,255,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <h3 style={{ fontSize: '1.1rem' }}>Visit #{visitNum}</h3>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatDate(visit.last_activity)}</div>
                                    </div>

                                    <div style={{ padding: '1rem 1.5rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontSize: '0.85rem' }}>
                                            <span style={{ color: '#6366f1', textDecoration: 'underline', cursor: 'pointer' }}>
                                                {visit.actions?.length || 0} Actions
                                            </span>
                                            <span style={{ color: 'var(--text-muted)' }}>
                                                {duration > 0 ? `${formatDuration(duration)} duration` : 'Single page view'}
                                            </span>
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            {(visit.actions || []).map((action, i) => (
                                                <div key={i} style={{ display: 'flex', gap: '10px', fontSize: '0.9rem' }}>
                                                    <div style={{ paddingTop: '4px' }}>
                                                        {action.type === 'page_view' ? <Layout size={14} color="#94a3b8" /> :
                                                            action.type === 'add_to_cart' ? <ShoppingCart size={14} color="#eab308" /> :
                                                                action.type === 'order' ? <CheckCircle size={14} color="#10b981" /> : <Activity size={14} />}
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: 500 }}>
                                                            {action.type === 'page_view' ? (action.title || 'Page View') :
                                                                action.type === 'add_to_cart' ? 'Added to Cart' :
                                                                    action.type === 'order' ? 'Placed Order' : action.type}
                                                        </div>
                                                        {action.url && (
                                                            <a href={action.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: 'var(--primary)', opacity: 0.8, textDecoration: 'underline' }}>
                                                                {new URL(action.url).pathname}
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                </div>
            </div>
        </div>
    );
};

const DebugView = ({ settings }) => {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [repairing, setRepairing] = useState(false);

    const checkStatus = async () => {
        if (!settings.storeUrl || !settings.consumerKey) return;
        setLoading(true);
        try {
            const data = await fetchSystemStatus(settings);
            setStatus(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        checkStatus();
    }, [settings]);

    const handleRepair = async () => {
        setRepairing(true);
        try {
            const { installDB } = await import('../services/api');
            await installDB(settings);
            toast.success("Database repair command sent");
            setTimeout(checkStatus, 2000);
        } catch (e) {
            toast.error("Repair failed: " + e.message);
        } finally {
            setRepairing(false);
        }
    };

    const handleTestVisit = async () => {
        try {
            const { createTestVisit } = await import('../services/api');
            await createTestVisit(settings);
            toast.success("Test visit created!");
            // Reload page or parent logs after short delay
            setTimeout(() => window.location.reload(), 1500);
        } catch (e) {
            toast.error("Test visit failed: " + e.message);
        }
    };

    if (loading) return <p>Checking system status...</p>;

    if (!status) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', color: '#f87171' }}>
                <AlertTriangle size={32} />
                <p>Could not connect to Helper Plugin v2.4.</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Please ensure you have re-uploaded 'woo-dashboard-helper.php' from the artifacts.</p>
            </div>
        );
    }

    if (!status.table_exists) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', color: '#fbbf24' }}>
                <Database size={32} />
                <p>Database Table `wc_dash_visits` is missing.</p>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button
                        onClick={handleRepair}
                        className="btn"
                        disabled={repairing}
                        style={{ background: 'rgba(251, 191, 36, 0.2)', color: '#fbbf24', border: '1px solid rgba(251, 191, 36, 0.5)' }}
                    >
                        {repairing ? <RefreshCw className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                        {repairing ? 'Repairing...' : 'Force Create Table'}
                    </button>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Try clicking the button above to manually trigger the table creation.</p>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <div style={{ opacity: 0.5 }}><Activity size={48} /></div>
            <p>No active sessions found.</p>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'left', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
                <div><strong>DB Version:</strong> {status.db_version}</div>
                <div><strong>Table:</strong> {status.table_name} (Exists: Yes)</div>
                <div><strong>Rows:</strong> {status.row_count}</div>
                <div><strong>Server Time:</strong> {status.server_time}</div>
            </div>
            <button onClick={handleTestVisit} className="btn" style={{ marginTop: '1rem' }}>
                Simulate Visitor Session
            </button>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Visit your store in a different browser/incognito window to generate a session.</p>
        </div>
    );
};

// Sub-component for expandable actions list
const VisitorActionsList = ({ actions }) => {
    const [expanded, setExpanded] = useState(false);
    const LIMIT = 10;

    // Sort reverse chronological (newest first)? Or keep chronological? Usually chronological is better for "journey". 
    // Assuming chronological (oldest at top) as per standard logs.

    const visibleActions = expanded ? actions : actions.slice(0, LIMIT);
    const hasMore = actions.length > LIMIT;
    const remaining = actions.length - LIMIT;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {visibleActions.map((action, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    {/* Icon */}
                    <div style={{ marginTop: '2px', color: '#94a3b8' }}>
                        {action.type === 'page_view' ? <FileText size={16} /> :
                            action.type === 'add_to_cart' ? <ShoppingCart size={16} color="#eab308" /> :
                                action.type === 'order' ? <DollarSign size={16} color="#10b981" /> : <Activity size={16} />}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1 }}>
                        {action.type === 'page_view' ? (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <a href={action.url} target="_blank" rel="noreferrer"
                                    style={{ fontWeight: 500, color: 'var(--text-main)', textDecoration: 'none', fontSize: '0.9rem' }}
                                    onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                                    onMouseLeave={e => e.target.style.textDecoration = 'none'}
                                >
                                    {action.title && action.title !== 'Unknown Page' ? action.title : 'Page View'}
                                </a>
                                <a href={action.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: 'var(--primary)', textDecoration: 'none', marginTop: '2px' }}>
                                    {action.url}
                                </a>
                            </div>
                        ) : action.type === 'add_to_cart' ? (
                            <div style={{ background: 'rgba(234, 179, 8, 0.1)', padding: '8px', borderRadius: '4px', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                                <strong style={{ color: '#eab308', fontSize: '0.85rem' }}>Added to Cart</strong>
                                <div style={{ fontSize: '0.85rem' }}>{action.qty}x {action.name}</div>
                            </div>
                        ) : action.type === 'order' ? (
                            <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '8px', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                                <strong style={{ color: '#10b981', fontSize: '0.85rem' }}>Order Placed</strong>
                                <div style={{ fontSize: '0.85rem' }}>Total: ${action.total}</div>
                            </div>
                        ) : (
                            <div style={{ fontSize: '0.9rem' }}>{action.type}</div>
                        )}
                    </div>
                </div>
            ))}

            {hasMore && (
                <div style={{ marginTop: '0.5rem' }}>
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="btn-text"
                        style={{ color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer', background: 'transparent', border: 'none', padding: 0, textDecoration: 'underline' }}
                    >
                        {expanded ? 'Show Less' : `+ ${remaining} more actions...`}
                    </button>
                </div>
            )}
        </div>
    );
};

const VisitorLog = () => {
    const { settings } = useSettings();
    const [searchParams] = useSearchParams();
    const activeView = searchParams.get('view') || 'realtime'; // 'realtime', 'channels', 'campaigns', 'url_builder', 'overview'

    // Date Filtering State
    const [dateRange, setDateRange] = useState({ label: 'Last 30 Days', days: 30 });
    const [compareMode, setCompareMode] = useState('none');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    const [selectedVisitorId, setSelectedVisitorId] = useState(null); // For Modal

    const [visits, setVisits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [locations, setLocations] = useState({}); // Cache for IP locations

    // Fetch location for an IP
    const resolveLocation = async (ip) => {
        if (locations[ip] || ip === '::1' || ip === '127.0.0.1') return;

        try {
            // Free IP API (Rate limited, but works for low volume)
            const res = await fetch(`/api/utils/geoip?ip=${ip}`);
            const data = await res.json();
            if (data.country_code) {
                setLocations(prev => ({
                    ...prev,
                    [ip]: {
                        country: data.country_name,
                        city: data.city,
                        code: data.country_code
                    }
                }));
            }
        } catch (e) {
            console.error("GeoIP Error", e);
        }
    };

    // Process visits to resolve IPs
    useEffect(() => {
        visits.forEach(v => {
            if (v.ip && !locations[v.ip]) {
                resolveLocation(v.ip);
            }
        });
    }, [visits]);

    const loadLogs = async () => {
        if (!settings.storeUrl || !settings.consumerKey) return;
        setLoading(true);
        try {
            const data = await fetchVisitorLog(settings);
            if (Array.isArray(data)) {
                // Sanitize actions to ensure they are arrays
                const safeData = data.map(v => ({
                    ...v,
                    actions: Array.isArray(v.actions) ? v.actions : []
                }));
                setVisits(safeData);
            } else {
                setVisits([]);
            }
        } catch (error) {
            console.error("Failed to fetch logs:", error);
            toast.error("Failed to load visitor logs");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadLogs();
        const interval = setInterval(loadLogs, 5000);
        return () => clearInterval(interval);
    }, [settings]);

    const getDeviceIcon = (device) => {
        if (!device) return <Monitor size={16} />;
        if (device.is_mobile) return <Smartphone size={16} />;
        return <Monitor size={16} />;
    };

    // Helper to get ID inside component scope if needed, or re-use logic
    const getVisitorID = (v) => v.visitor_id || v.cookie_id || v.ip;

    const getFlag = (ip) => {
        const loc = locations[ip];
        if (!loc) return <Globe size={16} color="#64748b" />;

        // Simple flag emoji generator from country code
        const flag = loc.code.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));

        return (
            <span title={`${loc.city}, ${loc.country}`} style={{ cursor: 'help', fontSize: '1.1rem', lineHeight: 1 }}>
                {flag}
            </span>
        );
    };

    const maskIP = (ip) => {
        if (!ip) return 'Unknown';
        // IPv4: 1.2.3.4 -> 1.2.*.*
        if (ip.includes('.')) {
            return ip.split('.').map((part, i) => i > 1 ? '***' : part).join('.');
        }
        // IPv6: show first segment only
        return ip.split(':')[0] + ':****:****...';
    };

    const getActionIcon = (type) => {
        switch (type) {
            case 'add_to_cart': return <ShoppingCart size={14} color="#eab308" />;
            case 'order': return <CheckCircle size={14} color="#10b981" />;
            default: return <Eye size={14} color="#94a3b8" />; // Default page view
        }
    };

    // --- Metrics Processing with Date Filtering ---
    const { filteredVisits, comparisons, showCompare } = useMemo(() => {
        if (!visits.length) return { filteredVisits: [], comparisons: {}, showCompare: false };

        // 1. Calculate Date Ranges
        const now = new Date();
        const days = dateRange.days || 36500;

        const endCurrent = new Date(now);
        const startCurrent = new Date(now);
        startCurrent.setDate(now.getDate() - days);

        // Previous Range
        const endPrev = new Date(startCurrent);
        const startPrev = new Date(startCurrent);
        if (compareMode === 'year') {
            endPrev.setFullYear(endPrev.getFullYear() - 1);
            startPrev.setFullYear(startPrev.getFullYear() - 1);
        } else {
            startPrev.setDate(startPrev.getDate() - days);
        }

        // 2. Filter Visits
        const currentVisits = [];
        const prevVisits = [];

        visits.forEach(v => {
            const date = new Date(v.last_activity);
            if (date >= startCurrent && date <= endCurrent) {
                currentVisits.push(v);
            } else if (compareMode !== 'none' && date >= startPrev && date <= endPrev) {
                prevVisits.push(v);
            }
        });

        // 3. Comparison Metrics
        const getChange = (curr, prev) => {
            if (!prev) return curr > 0 ? 100 : 0;
            return ((curr - prev) / prev) * 100;
        };

        const currentSource = currentVisits[0]?.referrer ? new URL(currentVisits[0].referrer).hostname : '-';

        // Count specific metrics for comparison
        const countCampaigns = (list) => {
            const set = new Set();
            list.forEach(v => {
                const entry = (v.actions || []).find(a => a.type === 'page_view');
                if (entry?.url && entry.url.includes('utm_campaign')) set.add(entry.url);
            });
            return set.size;
        };

        return {
            filteredVisits: currentVisits,
            showCompare: compareMode !== 'none',
            comparisons: {
                visitors: getChange(currentVisits.length, prevVisits.length),
                campaigns: getChange(countCampaigns(currentVisits), countCampaigns(prevVisits))
            }
        };
    }, [visits, dateRange, compareMode]);

    // Pagination Logic
    const totalItems = filteredVisits.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const paginatedVisits = filteredVisits.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    // Reset page if filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [filteredVisits]);

    // --- Aggregation Logic for Views (Uses Filtered Visits) ---

    const aggregatedStats = useMemo(() => {
        const stats = {
            referrers: {},
            campaigns: {},
            mediums: {},
            sources: {}
        };

        filteredVisits.forEach(v => {
            const referrer = v.referrer ? new URL(v.referrer).hostname : 'Direct';

            // Channel/Referrer Stats
            if (!stats.referrers[referrer]) stats.referrers[referrer] = { count: 0, orders: 0, revenue: 0 };
            stats.referrers[referrer].count++;

            // Check for orders
            const orders = (v.actions || []).filter(a => a.type === 'order');
            if (orders.length) {
                stats.referrers[referrer].orders += orders.length;
                stats.referrers[referrer].revenue += orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
            }

            // Campaign Stats (from Entry Page View)
            const entry = (v.actions || []).find(a => a.type === 'page_view');
            if (entry && entry.url) {
                try {
                    const url = new URL(entry.url);
                    const params = url.searchParams;

                    // Support standard UTM and Matomo MTM
                    // Matomo: mtm_campaign, mtm_source, mtm_medium, mtm_keyword, mtm_content, mtm_cid
                    const campaign = params.get('utm_campaign') || params.get('mtm_campaign') || params.get('mtm_cid');
                    const source = params.get('utm_source') || params.get('mtm_source');
                    const medium = params.get('utm_medium') || params.get('mtm_medium');

                    if (campaign) {
                        const key = campaign;
                        if (!stats.campaigns[key]) stats.campaigns[key] = { count: 0, source: source || 'N/A', medium: medium || 'N/A', orders: 0 };
                        stats.campaigns[key].count++;
                        if (orders.length) stats.campaigns[key].orders += orders.length;
                    }
                } catch (e) { }
            }
        });

        // Convert to Arrays
        return {
            referrers: Object.entries(stats.referrers).map(([k, v]) => ({ name: k, ...v })).sort((a, b) => b.count - a.count),
            campaigns: Object.entries(stats.campaigns).map(([k, v]) => ({ name: k, ...v })).sort((a, b) => b.count - a.count),
        }
    }, [filteredVisits]);

    // --- Sub-Views ---

    const ChannelsView = () => (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 className="section-title">Traffic Channels</h3>
            <table className="velocity-table" style={{ marginTop: '1rem' }}>
                <thead>
                    <tr>
                        <th>Channel / Referrer</th>
                        <th style={{ textAlign: 'right' }}>Sessions</th>
                        <th style={{ textAlign: 'right' }}>Orders</th>
                        <th style={{ textAlign: 'right' }}>Revenue</th>
                    </tr>
                </thead>
                <tbody>
                    {aggregatedStats.referrers.map((r, i) => (
                        <tr key={i}>
                            <td style={{ fontWeight: 500 }}>{r.name}</td>
                            <td style={{ textAlign: 'right' }}>{r.count}</td>
                            <td style={{ textAlign: 'right' }}>{r.orders}</td>
                            <td style={{ textAlign: 'right' }}>${r.revenue.toFixed(2)}</td>
                        </tr>
                    ))}
                    {aggregatedStats.referrers.length === 0 && (
                        <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2rem' }}>No data available yet.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );

    const CampaignsView = () => (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 className="section-title">Campaign Performance</h3>
            <p className="text-muted mb-4" style={{ fontSize: '0.9rem' }}>Tracking <code>utm_*</code> and <code>mtm_*</code> (Matomo) parameters.</p>
            <table className="velocity-table" style={{ marginTop: '1rem' }}>
                <thead>
                    <tr>
                        <th>Campaign</th>
                        <th>Source</th>
                        <th>Medium</th>
                        <th style={{ textAlign: 'right' }}>Sessions</th>
                        <th style={{ textAlign: 'right' }}>Orders</th>
                    </tr>
                </thead>
                <tbody>
                    {aggregatedStats.campaigns.map((c, i) => (
                        <tr key={i}>
                            <td style={{ fontWeight: 500, color: 'var(--primary)' }}>{c.name}</td>
                            <td>{c.source}</td>
                            <td>{c.medium}</td>
                            <td style={{ textAlign: 'right' }}>{c.count}</td>
                            <td style={{ textAlign: 'right' }}>{c.orders}</td>
                        </tr>
                    ))}
                    {aggregatedStats.campaigns.length === 0 && (
                        <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>No campaigns detected yet. Use the URL Builder to create tracked links.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );

    const UrlBuilderView = () => {
        const [form, setForm] = useState({ url: settings.storeUrl || 'https://mystore.com', source: '', medium: '', campaign: '', type: 'utm' }); // type: utm | mtm

        const generatedUrl = useMemo(() => {
            try {
                const u = new URL(form.url);
                const prefix = form.type === 'mtm' ? 'mtm' : 'utm';

                if (form.source) u.searchParams.set(`${prefix}_source`, form.source);
                if (form.medium) u.searchParams.set(`${prefix}_medium`, form.medium);
                if (form.campaign) u.searchParams.set(`${prefix}_campaign`, form.campaign);

                return u.toString();
            } catch (e) { return 'Invalid URL'; }
        }, [form]);

        const copyToClipboard = () => {
            navigator.clipboard.writeText(generatedUrl);
            toast.success("URL copied to clipboard!");
        };

        return (
            <div className="glass-panel" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
                <h3 className="section-title">Campaign URL Builder</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>Generate trackable URLs for your marketing campaigns.</p>

                <div style={{ display: 'grid', gap: '1rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                            <input
                                type="radio"
                                name="type"
                                checked={form.type === 'utm'}
                                onChange={() => setForm({ ...form, type: 'utm' })}
                            />
                            Standard (UTM)
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                            <input
                                type="radio"
                                name="type"
                                checked={form.type === 'mtm'}
                                onChange={() => setForm({ ...form, type: 'mtm' })}
                            />
                            Matomo (MTM)
                        </label>
                    </div>

                    <div>
                        <label className="form-label">Website URL</label>
                        <input className="form-input" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://..." />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label className="form-label">Campaign Source</label>
                            <input className="form-input" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} placeholder="e.g. google, newsletter" />
                        </div>
                        <div>
                            <label className="form-label">Campaign Medium</label>
                            <input className="form-input" value={form.medium} onChange={e => setForm({ ...form, medium: e.target.value })} placeholder="e.g. cpc, email" />
                        </div>
                        <div>
                            <label className="form-label">Campaign Name</label>
                            <input className="form-input" value={form.campaign} onChange={e => setForm({ ...form, campaign: e.target.value })} placeholder="e.g. spring_sale" />
                        </div>
                    </div>

                    <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                        <label className="form-label" style={{ marginBottom: '0.5rem' }}>Generated URL</label>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <input className="form-input" value={generatedUrl} readOnly style={{ fontFamily: 'monospace', color: 'var(--primary)' }} />
                            <button onClick={copyToClipboard} className="btn btn-primary">Copy</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const OverviewView = () => {
        // Safe access functions for values & comparison
        const isPos = (val) => val >= 0;
        const fmt = (val) => `${val > 0 ? '+' : ''}${val.toFixed(1)}%`;

        return (
            <div style={{ display: 'grid', gap: '2rem' }}>
                <div className="stats-grid">
                    <div className="glass-card stat-card">
                        <h3 className="stat-title">Sessions</h3>
                        <p className="stat-value">{filteredVisits.length}</p>
                        <p className="stat-subtext">in selected period</p>
                        {showCompare && (
                            <div style={{ fontSize: '0.8rem', color: isPos(comparisons.visitors) ? '#10b981' : '#ef4444' }}>
                                {fmt(comparisons.visitors)} vs previous
                            </div>
                        )}
                    </div>
                    <div className="glass-card stat-card">
                        <h3 className="stat-title">Top Source</h3>
                        <p className="stat-value" style={{ fontSize: '1.5rem' }}>{aggregatedStats.referrers[0]?.name || '-'}</p>
                        <p className="stat-subtext">{aggregatedStats.referrers[0]?.count || 0} sessions</p>
                    </div>
                    <div className="glass-card stat-card">
                        <h3 className="stat-title">Active Campaigns</h3>
                        <p className="stat-value">{aggregatedStats.campaigns.length}</p>
                        <p className="stat-subtext">UTM Campaigns</p>
                        {showCompare && (
                            <div style={{ fontSize: '0.8rem', color: isPos(comparisons.campaigns) ? '#10b981' : '#ef4444' }}>
                                {fmt(comparisons.campaigns)} vs previous
                            </div>
                        )}
                    </div>
                </div>
                {/* Quick Links */}
                <div className="quick-links-grid">
                    <ChannelsView />
                    <CampaignsView />
                </div>
            </div>
        );
    };

    return (
        <div className="visitor-page">
            <div className="visitor-header">
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', background: 'linear-gradient(to right, #f8fafc, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        {activeView === 'overview' ? 'Acquisition Overview' :
                            activeView === 'channels' ? 'Traffic Channels' :
                                activeView === 'campaigns' ? 'Campaigns' :
                                    activeView === 'url_builder' ? 'URL Builder' : 'Real-time Visits'}
                    </h1>
                    <p style={{ color: 'var(--text-muted)' }}>
                        {activeView === 'overview' ? 'High level view of your traffic sources.' :
                            activeView === 'realtime' ? 'Live feed of customer sessions' :
                                activeView === 'url_builder' ? 'Create trackable links for your marketing.' : 'Analyze where your traffic is coming from.'}
                    </p>
                </div>
                <div className="visitor-controls">
                    <button
                        onClick={loadLogs}
                        className="btn"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)' }}
                    >
                        <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                        Refresh
                    </button>
                    <div style={{ marginLeft: '10px' }}>
                        <DateRangePicker
                            range={dateRange}
                            onChange={setDateRange}
                            compareMode={compareMode}
                            onCompareChange={setCompareMode}
                        />
                    </div>
                </div>
            </div>

            {activeView === 'overview' && <OverviewView />}
            {activeView === 'channels' && <ChannelsView />}
            {activeView === 'campaigns' && <CampaignsView />}
            {activeView === 'url_builder' && <UrlBuilderView />}

            {activeView === 'realtime' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {paginatedVisits.length > 0 ? (
                        paginatedVisits.map((visit) => {
                            // Analysis Logic
                            const actions = visit.actions || [];
                            const pageViews = actions.filter(a => a.type === 'page_view');
                            const entryPage = pageViews[0] || null;
                            const exitPage = pageViews[pageViews.length - 1] || null;

                            // Calculate Duration
                            const startTime = actions.length > 0 ? actions[0].time : 0;
                            const endTime = actions.length > 0 ? actions[actions.length - 1].time : 0;
                            const durationSeconds = endTime - startTime;

                            // Parse UTMs/MTMs from Entry URL
                            const getUTMs = (url) => {
                                if (!url) return null;
                                try {
                                    const urlObj = new URL(url);
                                    const params = new URLSearchParams(urlObj.search);

                                    const source = params.get('utm_source') || params.get('mtm_source');
                                    const medium = params.get('utm_medium') || params.get('mtm_medium');
                                    const campaign = params.get('utm_campaign') || params.get('mtm_campaign') || params.get('mtm_cid');

                                    if (source || medium || campaign) return { source, medium, campaign };
                                } catch (e) { return null; }
                                return null;
                            };
                            const utms = entryPage ? getUTMs(entryPage.url) : null;

                            // --- NEW LAYOUT: Matomo/Screenshot Style ---
                            return (
                                <div key={visit.id} className="visit-row">

                                    {/* Left Column: Visitor Meta */}
                                    <div className="visit-meta">
                                        <div className="date-time" style={{ fontWeight: 'bold', fontSize: '0.95rem', marginBottom: '4px' }}>
                                            {new Date(visit.last_activity).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                            {' - '}
                                            {new Date(visit.last_activity).toLocaleTimeString()}
                                        </div>

                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '1rem' }}>
                                            {getFlag(visit.ip)}
                                            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                                {locations[visit.ip] ? locations[visit.ip].city : maskIP(visit.ip)}
                                            </span>
                                        </div>

                                        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                                                {/* Identity Icon */}
                                                {(() => {
                                                    const identity = getVisitorIdentity(visit);
                                                    if (identity) return <span title={identity.label}>{identity.icon}</span>;
                                                    return null;
                                                })()}

                                                {visit.device_info?.is_mobile ? <Smartphone size={14} /> : <Monitor size={14} />}
                                                {visit.device_info?.os}
                                                {visit.device_info?.browser && ` / ${visit.device_info.browser}`}
                                            </div>

                                        </div>

                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                                            {(() => {
                                                const identity = getVisitorIdentity(visit);
                                                if (identity) {
                                                    return (
                                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                            <strong style={{ color: identity.type === 'AI' ? '#10b981' : '#60a5fa' }}>{identity.type === 'AI' ? 'AI Agent' : 'Social'}</strong>
                                                            <span>{identity.label}</span>
                                                        </div>
                                                    );
                                                }
                                                if (visit.referrer) {
                                                    return (
                                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                            <strong style={{ color: '#10b981' }}>Referrer</strong>
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }} title={visit.referrer}>
                                                                {new URL(visit.referrer).hostname}
                                                            </span>
                                                        </div>
                                                    );
                                                }
                                                return <span style={{ color: '#94a3b8' }}>Direct Entry</span>;
                                            })()}
                                        </div>

                                        <div style={{ marginTop: '1rem' }}>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setSelectedVisitorId(getVisitorID(visit)); }}
                                                className="btn-text"
                                                style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--primary)', fontSize: '0.8rem', padding: 0 }}
                                            >
                                                <Activity size={12} /> View Visitor Profile
                                            </button>
                                        </div>
                                    </div>

                                    {/* Right Column: Actions List */}
                                    <div className="visit-content">
                                        <div className="visit-content-header">
                                            {actions.length} Actions - {Math.floor(durationSeconds / 60)} min {durationSeconds % 60}s
                                        </div>

                                        <VisitorActionsList actions={actions} />
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <DebugView settings={settings} />
                        </div>
                    )}
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        itemsPerPage={itemsPerPage}
                        onPageChange={setCurrentPage}
                        onItemsPerPageChange={setItemsPerPage}
                        totalItems={totalItems}
                    />
                </div>
            )
            }

            {/* Inline Styles for Tooltip Hover */}
            <style>{`
                .tooltip-text { visibility: hidden; opacity: 0; transition: opacity 0.2s; }
                .tooltip-container:hover .tooltip-text { visibility: visible; opacity: 1; }
            `}</style>

            {/* Modal */}
            <VisitorProfileModal
                visitorId={selectedVisitorId}
                allVisits={visits}
                isOpen={!!selectedVisitorId}
                onClose={() => setSelectedVisitorId(null)}
            />
        </div >
    );
};

export default VisitorLog;
