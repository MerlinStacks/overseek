import React, { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Search, Bell, AlertCircle, CheckCircle, X, Sun, Moon, Menu } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import Sidebar from '../components/Sidebar';
import GlobalSearch from '../components/GlobalSearch';
import SyncOverlay from '../components/SyncOverlay';
import SyncIndicator from '../components/SyncIndicator';
import TodoPanel from '../components/TodoPanel';
import { useSettings } from '../context/SettingsContext';
import { useAccount } from '../context/AccountContext';
import ErrorBoundary from '../components/ErrorBoundary';
import './DashboardLayout.css';
import PresenceIndicator from '../components/PresenceIndicator';

// ...

const Notifications = () => {
    const dropdownRef = useRef(null);
    const [isOpen, setIsOpen] = useState(false);

    // Track dismissed notifications
    const [dismissedIds, setDismissedIds] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('dismissed_notifications') || '[]');
        } catch { return []; }
    });

    // Live Queries for Alerts
    const lowStockProducts = useLiveQuery(() =>
        db.products.where('stock_quantity').below(5).and(p => p.stock_quantity !== null).toArray()
    ) || [];

    const pendingOrders = useLiveQuery(() =>
        db.orders.where('status').equals('pending').toArray()
    ) || [];

    // Construct alerts
    const allAlerts = [
        ...lowStockProducts.map(p => ({
            id: `prod-${p.id}`,
            type: 'warning',
            text: `Low Stock: ${p.name} (${p.stock_quantity} left)`,
            link: `/products/${p.id}`
        })),
        ...pendingOrders.map(o => ({
            id: `ord-${o.id}`,
            type: 'info',
            text: `New Order #${o.id} is pending`,
            link: `/orders/${o.id}`
        }))
    ];

    // Filter dismissed
    const alerts = allAlerts.filter(a => !dismissedIds.includes(a.id)).slice(0, 10);

    const handleClearAll = (e) => {
        if (e) e.stopPropagation();
        // Dismiss ALL currently active alerts (preventing the "next 10" from popping up)
        const newDismissed = [...new Set([...dismissedIds, ...allAlerts.map(a => a.id)])];
        setDismissedIds(newDismissed);
        localStorage.setItem('dismissed_notifications', JSON.stringify(newDismissed));
        toast.success("All notifications cleared");
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="notifications-wrapper" ref={dropdownRef} style={{ position: 'relative' }}>
            <button
                className="btn-icon"
                onClick={() => setIsOpen(!isOpen)}
                style={{ position: 'relative', background: isOpen ? 'rgba(255,255,255,0.1)' : 'transparent', color: 'var(--text-main)' }}
            >
                <Bell size={20} />
                {alerts.length > 0 && (
                    <span style={{
                        position: 'absolute', top: '0', right: '0',
                        width: '8px', height: '8px', background: '#ef4444',
                        borderRadius: '50%', border: '2px solid var(--bg-color)'
                    }} />
                )}
            </button>

            {isOpen && (
                <div className="glass-panel" style={{
                    position: 'absolute', top: '120%', right: 0,
                    width: '320px', padding: '0', zIndex: 100,
                    boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                    border: '1px solid var(--border-glass)'
                }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <h4 style={{ fontWeight: 'bold', fontSize: '0.9rem', margin: 0 }}>Notifications</h4>
                            {alerts.length > 0 && <span style={{ fontSize: '0.7rem', background: '#ef4444', color: 'white', padding: '1px 6px', borderRadius: '10px' }}>{alerts.length}</span>}
                        </div>
                        {alerts.length > 0 && (
                            <button
                                onClick={handleClearAll}
                                style={{
                                    background: 'transparent', border: 'none', color: 'var(--text-muted)',
                                    fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline'
                                }}
                            >
                                Clear All
                            </button>
                        )}
                    </div>
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        {alerts.length > 0 ? (
                            alerts.map(alert => (
                                <div
                                    key={alert.id}
                                    onClick={() => { setIsOpen(false); window.location.href = alert.link; }}
                                    style={{
                                        padding: '12px 16px',
                                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        gap: '12px',
                                        alignItems: 'start'
                                    }}
                                    className="hover:bg-white/5"
                                >
                                    {alert.type === 'warning' ? (
                                        <AlertCircle size={16} color="#f59e0b" style={{ marginTop: '3px' }} />
                                    ) : (
                                        <CheckCircle size={16} color="#3b82f6" style={{ marginTop: '3px' }} />
                                    )}
                                    <span style={{ fontSize: '0.85rem', lineHeight: '1.4' }}>{alert.text}</span>
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                No new notifications
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const ThemeToggle = () => {
    const [theme, setTheme] = useState('dark');

    useEffect(() => {
        const saved = localStorage.getItem('theme') || 'dark';
        setTheme(saved);
        document.documentElement.setAttribute('data-theme', saved);
    }, []);

    const toggleTheme = () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
    };

    return (
        <button
            className="btn-icon"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            style={{ background: 'transparent' }}
        >
            {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
        </button>
    );
};

const Clock = () => {
    const { settings } = useSettings();
    const [timeString, setTimeString] = useState('');

    useEffect(() => {
        const updateTime = () => {
            const tz = settings.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
            try {
                const now = new Date();
                const options = {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZone: tz
                };
                setTimeString(new Intl.DateTimeFormat('en-US', options).format(now));
            } catch (e) {
                // Fallback if timezone is invalid
                setTimeString(new Date().toLocaleString());
            }
        };

        updateTime();
        const interval = setInterval(updateTime, 1000);
        return () => clearInterval(interval);
    }, [settings.timeZone]);

    return <p className="date-display" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{timeString}</p>;
};


const DashboardLayout = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { activeAccount } = useAccount();
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // Close mobile menu on route change
    useEffect(() => {
        setMobileMenuOpen(false);
    }, [location]);

    return (
        <div className={`dashboard-layout ${sidebarCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}>
            {/* Mobile Overlay */}
            {mobileMenuOpen && (
                <div
                    className="mobile-overlay"
                    onClick={() => setMobileMenuOpen(false)}
                />
            )}

            <Sidebar
                collapsed={sidebarCollapsed}
                toggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
                mobileOpen={mobileMenuOpen}
                closeMobile={() => setMobileMenuOpen(false)}
            />

            <main className="main-content">
                <SyncOverlay />
                <header className="top-bar">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        {/* Mobile Menu Toggle */}
                        <button
                            className="mobile-menu-btn"
                            onClick={() => setMobileMenuOpen(true)}
                        >
                            <Menu size={24} />
                        </button>

                        <div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                                <h2 className="page-title" style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                                    {location.pathname === '/' ? 'Dashboard' :
                                        location.pathname.split('/')[1]?.charAt(0).toUpperCase() + location.pathname.split('/')[1]?.slice(1) || 'Dashboard'}
                                </h2>
                                {activeAccount && (
                                    <span className="account-badge">
                                        {activeAccount.name}
                                    </span>
                                )}
                            </div>
                            <Clock />
                        </div>
                    </div>

                    <div className="actions" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <PresenceIndicator />
                        <SyncIndicator />
                        <GlobalSearch />
                        <ThemeToggle />
                        <TodoPanel />
                        <Notifications />
                    </div>
                </header>
                <div className="content-area" style={{ flex: 1, overflowY: 'auto' }}>
                    <ErrorBoundary>
                        <Outlet />
                    </ErrorBoundary>
                </div>
            </main>
        </div>
    );
};

export default DashboardLayout;
