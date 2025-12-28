import React, { useState } from 'react';
import { Database, Trash2, Activity, Wifi, RefreshCw, Server, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { restartServer } from '../../services/api'; // We can add new helpers here or fetch directly for now
import axios from 'axios';
import { useSettings } from '../../context/SettingsContext';

const AdminToolsPage = () => {
    const { settings } = useSettings();
    const [pingResult, setPingResult] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleClearCache = async () => {
        setLoading(true);
        try {
            await axios.post('/admin/cache/clear');
            toast.success('Redis Cache successfully cleared');
        } catch (e) {
            toast.error('Failed to clear cache');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handlePing = async () => {
        setLoading(true);
        setPingResult(null);
        try {
            const target = settings.storeUrl || 'https://google.com';
            const res = await axios.post('/admin/ping', { url: target });
            setPingResult({ success: true, ...res.data });
            toast.success(`Ping successful: ${res.data.latency}ms`);
        } catch (e) {
            setPingResult({ success: false, error: e.response?.data?.error || e.message });
            toast.error('Ping failed');
        } finally {
            setLoading(false);
        }
    };

    const handleResetLocalDB = async () => {
        if (!confirm('WARNING: This will delete the entire local database in your browser. All offline data will be lost. Are you sure?')) return;
        try {
            // Dexie specific
            const dbs = await window.indexedDB.databases();
            dbs.forEach(db => {
                window.indexedDB.deleteDatabase(db.name);
            });
            toast.success('Local database cleared. Reloading...');
            setTimeout(() => window.location.reload(), 1500);
        } catch (e) {
            toast.error('Failed to reset local DB');
            console.error(e);
        }
    };

    return (
        <div style={{ padding: '2rem' }}>
            <div style={{ marginBottom: '2rem' }}>
                <h1 style={{ fontSize: '2rem', fontWeight: 'bold' }}>System Tools</h1>
                <p style={{ color: 'var(--text-muted)' }}>Diagnostics and maintenance utilities.</p>
            </div>

            <div className="admin-dashboard-grid">

                {/* Cache Control */}
                <div className="admin-card col-span-6" style={{ padding: '2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                        <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '10px', color: '#ef4444' }}>
                            <Trash2 size={24} />
                        </div>
                        <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Cache Control</h3>
                    </div>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: '1.5' }}>
                        Clear the server-side Redis cache. This will force the backend to re-fetch fresh data from WooCommerce on the next request.
                    </p>
                    <button
                        className="btn"
                        onClick={handleClearCache}
                        disabled={loading}
                        style={{ background: '#ef4444', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
                    >
                        {loading ? 'Processing...' : 'Purge Redis Cache'}
                    </button>
                </div>

                {/* Network Diagnostics */}
                <div className="admin-card col-span-6" style={{ padding: '2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                        <div style={{ padding: '10px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '10px', color: '#3b82f6' }}>
                            <Wifi size={24} />
                        </div>
                        <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Connectivity Test</h3>
                    </div>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: '1.5' }}>
                        Test the connection latency between the Middleware Server and your WooCommerce store ({settings.storeUrl || 'Not Configured'}).
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <button
                            className="btn"
                            onClick={handlePing}
                            disabled={loading}
                            style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
                        >
                            {loading ? 'Pinging...' : 'Ping Store'}
                        </button>
                        {pingResult && (
                            <div style={{
                                padding: '8px 12px', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600,
                                background: pingResult.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                color: pingResult.success ? '#10b981' : '#ef4444'
                            }}>
                                {pingResult.success ? `Connected: ${pingResult.latency}ms` : `Error: ${pingResult.error}`}
                            </div>
                        )}
                    </div>
                </div>

                {/* Dangerous Zone */}
                <div className="admin-card col-span-12" style={{ padding: '2rem', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                        <div style={{ padding: '10px', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '10px', color: '#f59e0b' }}>
                            <AlertTriangle size={24} />
                        </div>
                        <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Client Diagnostics</h3>
                    </div>
                    <div style={{ display: 'flex', gap: '2rem' }}>
                        <div style={{ flex: 1 }}>
                            <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Local Database Reset</h4>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                                Wipes the browser's IndexedDB. Useful if the client application is stuck in an inconsistent state.
                            </p>
                            <button
                                className="btn"
                                onClick={handleResetLocalDB}
                                style={{ background: 'transparent', border: '1px solid #f59e0b', color: '#f59e0b', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                            >
                                Reset Local DB
                            </button>
                        </div>
                        <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)' }} />
                        <div style={{ flex: 1 }}>
                            <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Force Reload</h4>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                                Forces a hard reload of the application, bypassing the service worker cache.
                            </p>
                            <button
                                className="btn"
                                onClick={() => window.location.reload(true)}
                                style={{ background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-main)', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                            >
                                Hard Reload Window
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default AdminToolsPage;
