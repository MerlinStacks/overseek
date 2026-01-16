import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { Activity, Download, Trash2, RefreshCw, Server, Mail, ShoppingBag } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export function SystemHealth() {
    const { token } = useAuth();
    const [stats, setStats] = useState<any>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const fetchStats = async () => {
        setIsLoading(true);
        try {
            // Placeholder: accessing a hypothetical system-stats endpoint
            // In a real app, you'd likely have a dedicated admin route.
            // For now, we'll simulate or use a safe fallback if the endpoint doesn't exist yet.
            const res = await fetch('/api/admin/system-stats', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            }
        } catch (error) {
            Logger.error('Failed to fetch stats', { error: error });
        } finally {
            setIsLoading(false);
        }
    };

    const fetchLogs = async () => {
        try {
            const res = await fetch('/api/admin/logs', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json(); // Assuming returns { files: ["error.log", "debug.log"] }
                setLogs(data.files || []);
            }
        } catch (error) {
            Logger.error('Failed to fetch logs', { error: error });
        }
    };

    useEffect(() => {
        if (token) {
            fetchStats();
            fetchLogs();
        }
    }, [token]);

    const handleDownloadLog = async (filename: string) => {
        try {
            const res = await fetch(`/api/admin/logs/download?file=${filename}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error("Download failed");

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            alert('Failed to download log');
        }
    };

    const handleClearLogs = async () => {
        if (!confirm("Are you sure you want to clear all server logs? This cannot be undone.")) return;
        try {
            const res = await fetch('/api/admin/logs', {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                alert('Logs cleared');
                fetchLogs();
            }
        } catch (error) {
            alert('Failed to clear logs');
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-6">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                            <Activity className="text-blue-600" size={20} />
                            System Health & Logs
                        </h2>
                        <p className="text-sm text-gray-500">Monitor server status and manage Application logs.</p>
                    </div>
                    <button onClick={fetchStats} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors">
                        <RefreshCw size={18} className={isLoading ? "animate-spin" : ""} />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                                <Server size={16} />
                            </div>
                            <span className="text-sm font-medium text-gray-700">Server Status</span>
                        </div>
                        <div className="text-2xl font-semibold text-gray-900">{stats?.uptime ? 'Online' : 'Unknown'}</div>
                        <div className="text-xs text-gray-500 mt-1">Uptime: {stats?.uptime || '--'}</div>
                    </div>
                    {/* Add more cards for Memory, DB Status etc. */}
                </div>

                <div className="border-t border-gray-100 pt-6">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm font-medium text-gray-900">Log Files</h3>
                        <button
                            onClick={handleClearLogs}
                            className="text-red-600 hover:text-red-700 text-sm flex items-center gap-1 px-3 py-1.5 hover:bg-red-50 rounded-lg transition-colors"
                        >
                            <Trash2 size={14} />
                            Clear All Logs
                        </button>
                    </div>

                    <div className="bg-slate-50 rounded-lg border border-slate-200 divide-y divide-slate-100">
                        {logs.length > 0 ? (
                            logs.map(log => (
                                <div key={log} className="p-3 flex justify-between items-center text-sm">
                                    <span className="font-mono text-slate-700">{log}</span>
                                    <button
                                        onClick={() => handleDownloadLog(log)}
                                        className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                    >
                                        <Download size={14} />
                                        Download
                                    </button>
                                </div>
                            ))
                        ) : (
                            <div className="p-4 text-center text-gray-400 text-sm">No log files found</div>
                        )}
                    </div>
                </div>

                <div className="border-t border-gray-100 pt-6 mt-6">
                    <h3 className="text-sm font-medium text-gray-900 mb-4">Quick Diagnostics</h3>
                    <div className="flex gap-4">
                        <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                            <Mail size={16} />
                            Test Email System
                        </button>
                        <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                            <ShoppingBag size={16} />
                            Test Woo Connection
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
