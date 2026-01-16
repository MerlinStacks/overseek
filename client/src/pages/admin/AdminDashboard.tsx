import { useEffect, useState } from 'react';
import { Logger } from '../../utils/logger';
import { Users, Server, Activity, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface AdminStats {
    totalAccounts: number;
    totalUsers: number;
    activeSyncs: number;
    failedSyncs24h: number;
}

export function AdminDashboard() {
    const { token } = useAuth();
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/admin/stats', {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(res => {
                if (!res.ok) {
                    throw new Error(`Failed to fetch stats: ${res.status}`);
                }
                return res.json();
            })
            .then(data => {
                setStats(data);
                setLoading(false);
            })
            .catch(err => {
                Logger.error('AdminDashboard stats fetch error:', { error: err });
                setLoading(false);
            });
    }, [token]);

    const StatCard = ({ title, value, icon: Icon, color }: any) => (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-sm font-medium text-slate-500">{title}</p>
                    <h3 className="text-3xl font-bold mt-2 text-slate-900">{value}</h3>
                </div>
                <div className={`p-3 rounded-lg ${color}`}>
                    <Icon className="text-white" size={24} />
                </div>
            </div>
        </div>
    );

    if (loading) return <div>Loading admin stats...</div>;

    return (
        <div>
            <h1 className="text-2xl font-bold text-slate-800 mb-6">System Overview</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    title="Total Accounts"
                    value={stats?.totalAccounts || 0}
                    icon={Server}
                    color="bg-blue-600"
                />
                <StatCard
                    title="Total Users"
                    value={stats?.totalUsers || 0}
                    icon={Users}
                    color="bg-emerald-600"
                />
                <StatCard
                    title="Active Syncs"
                    value={stats?.activeSyncs || 0}
                    icon={Activity}
                    color="bg-indigo-600"
                />
                <StatCard
                    title="Failed Syncs (24h)"
                    value={stats?.failedSyncs24h || 0}
                    icon={AlertTriangle}
                    color="bg-rose-600"
                />
            </div>
        </div>
    );
}
