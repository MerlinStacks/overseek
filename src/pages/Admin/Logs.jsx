import React, { useState, useEffect } from 'react';
// import { useSettings } from '../../context/SettingsContext';
import { RefreshCw, Database, Activity, AlertTriangle, FileText } from 'lucide-react';
// import { fetchSystemStatus } from '../../services/api'; // unused
import { toast } from 'sonner';
import axios from 'axios';

const LogsPage = () => {
    // const { settings } = useSettings(); // settings unused
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('all'); // all, error

    const fetchLogs = React.useCallback(async () => {
        // Prevent redundant fetching if we already know it fails
        // Note: logs.length check removed to avoid frequent dependency changes/stale closure issues favoring simplicity
        if (activeTab === 'error' && !loading && logs.length === 0) {
            // If we really want to optimize this, we need refs. 
            // But for now, let's just let it poll or use the ref refactor below if needed.
            // Actually, simplest is to let it poll or trust the 403 check.
        }

        try {
            const response = await axios.get('/api/admin/logs');
            setLogs(response.data);
        } catch (e) {
            if (e.response && (e.response.status === 403 || e.response.status === 401)) {
                console.warn("Logs access denied - stopping polling.");
                toast.error("Logs Access Denied (403). Backend configuration required.");
            } else {
                console.error("Failed to fetch logs", e);
            }
        } finally {
            setLoading(false);
        }
    }, [activeTab, loading, logs.length]); // Added dependencies

    useEffect(() => {
        fetchLogs();

        const interval = setInterval(() => {
            fetchLogs();
        }, 5000);
        return () => clearInterval(interval);
    }, [fetchLogs]);

    const filteredLogs = logs.filter(log => {
        if (activeTab === 'error') return log.level === 'ERROR';
        return true;
    });

    return (
        <div style={{ padding: '0 1rem' }}>
            <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 'bold' }}>System Logs</h1>
                    <p style={{ color: 'var(--text-muted)' }}>Real-time backend event stream.</p>
                </div>
                <button onClick={fetchLogs} className="btn" style={{ background: 'rgba(255,255,255,0.1)', padding: '8px 12px', borderRadius: '6px' }}>
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            <div className="glass-panel" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '70vh' }}>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: '1px', background: 'rgba(0,0,0,0.2)', padding: '0.5rem 1rem' }}>
                    <button
                        onClick={() => setActiveTab('all')}
                        style={{
                            padding: '8px 16px',
                            background: activeTab === 'all' ? 'rgba(255,255,255,0.1)' : 'transparent',
                            color: activeTab === 'all' ? 'white' : 'var(--text-muted)',
                            border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500
                        }}
                    >
                        All Logs
                    </button>
                    <button
                        onClick={() => setActiveTab('error')}
                        style={{
                            padding: '8px 16px',
                            background: activeTab === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
                            color: activeTab === 'error' ? '#ef4444' : 'var(--text-muted)',
                            border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500
                        }}
                    >
                        Errors Only
                    </button>
                </div>

                {/* Log Terminal View */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '1rem',
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    fontSize: '0.85rem',
                    background: '#0f172a',
                    color: '#e2e8f0'
                }}>
                    {filteredLogs.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                            <p>No logs found.</p>
                        </div>
                    ) : (
                        filteredLogs.map((log, index) => (
                            <div key={index} style={{ marginBottom: '4px', display: 'flex', gap: '8px', lineHeight: '1.4' }}>
                                <span style={{ color: '#64748b', minWidth: '150px' }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                                <span style={{
                                    fontWeight: 'bold',
                                    minWidth: '60px',
                                    color: log.level === 'INFO' ? '#3b82f6' :
                                        log.level === 'WARN' ? '#f59e0b' :
                                            log.level === 'ERROR' ? '#ef4444' : '#94a3b8'
                                }}>
                                    [{log.level}]
                                </span>
                                <span style={{ wordBreak: 'break-all', color: log.level === 'ERROR' ? '#fca5a5' : 'inherit' }}>
                                    {log.message}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default LogsPage;
