import React from 'react';
import { useAccount } from '../../context/AccountContext';
import { useNavigate } from 'react-router-dom';
import { restartServer } from '../../services/api';
import { toast } from 'sonner';
import { Users, FileText, Activity, Server, Database, TrendingUp, Clock, HardDrive, Cpu } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';



const AdminDashboard = () => {
    const { accounts } = useAccount();
    const navigate = useNavigate();

    const handleRestart = async () => {
        if (!confirm('Are you sure you want to restart the backend server? This will temporarily disrupt active connections.')) return;

        try {
            toast.info('Sending restart signal...');
            // We pass empty settings because restartServer handles localhost default internally
            await restartServer({ storeUrl: 'http://localhost:4000' });
            toast.success('Server is restarting. It will be back in a few seconds.');
        } catch (error) {
            console.error('Restart failed:', error);
            toast.error('Failed to send restart signal');
        }
    };

    return (
        <div className="admin-dashboard-grid">
            {/* Header */}
            <div className="col-span-12" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 'bold' }}>Command Center</h1>
                    <p style={{ color: 'var(--text-muted)' }}>System Overview & Diagnostics</p>
                </div>
                <button
                    className="btn"
                    style={{
                        background: '#ef4444',
                        color: 'white',
                        border: 'none',
                        padding: '10px 20px',
                        borderRadius: '8px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                    onClick={handleRestart}
                >
                    <Activity size={18} />
                    Restart Server
                </button>
            </div>

            {/* Quick Stats Row */}
            <div className="admin-card col-span-3" onClick={() => navigate('/admin/accounts')} style={{ padding: '1.5rem', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '10px', borderRadius: '10px', color: '#3b82f6' }}>
                        <Users size={24} />
                    </div>
                    <span className="status-dot green" />
                </div>
                <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Active Accounts</h3>
                <div className="admin-stat-value" style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>{accounts.length}</div>
            </div>

            <div className="admin-card col-span-3" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '10px', borderRadius: '10px', color: '#10b981' }}>
                        <Activity size={24} />
                    </div>
                    <span className="status-dot green" />
                </div>
                <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>System Health</h3>
                <div className="admin-stat-value" style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>98%</div>
            </div>

            <div className="admin-card col-span-3" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '10px', borderRadius: '10px', color: '#f59e0b' }}>
                        <Database size={24} />
                    </div>
                </div>
                <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>DB Operations</h3>
                <div className="admin-stat-value" style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>1.2k</div>
            </div>

            <div className="admin-card col-span-3" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '10px', color: '#ef4444' }}>
                        <Clock size={24} />
                    </div>
                </div>
                <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Avg Latency</h3>
                <div className="admin-stat-value" style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>42ms</div>
            </div>

            {/* Main Content Area */}
            <div className="col-span-12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1.5rem' }}>

                {/* Real System Logs Preview */}
                <div className="admin-card col-span-12" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <FileText size={18} /> Recent System Events
                        </h3>
                        <button onClick={() => navigate('/admin/logs')} className="btn-text" style={{ fontSize: '0.9rem' }}>View All Logs &rarr;</button>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.9rem' }}>
                        Check the <span style={{ color: '#3b82f6', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate('/admin/logs')}>System Logs</span> page for real-time server activity stream.
                    </div>
                </div>

            </div>



        </div>
    );
};

export default AdminDashboard;
