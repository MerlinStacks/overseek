import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { Plus, Trash2, Loader2, Globe, Shield, HelpCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

/**
 * TrackingExclusionSettings - Manage IP addresses excluded from analytics tracking.
 *
 * Allows admins to add IPs (e.g., their own, team members) that should be
 * excluded from live visitor counts, logs, and reports.
 */
export function TrackingExclusionSettings() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [excludedIps, setExcludedIps] = useState<string[]>([]);
    const [newIp, setNewIp] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isAdding, setIsAdding] = useState(false);
    const [isDetecting, setIsDetecting] = useState(false);
    const [deletingIp, setDeletingIp] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchExcludedIps = useCallback(async () => {
        if (!currentAccount || !token) return;

        try {
            setIsLoading(true);
            const res = await fetch(`/api/accounts/${currentAccount.id}/excluded-ips`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) throw new Error('Failed to fetch excluded IPs');

            const data = await res.json();
            setExcludedIps(data.excludedIps || []);
        } catch (err) {
            Logger.error('Failed to fetch excluded IPs', { error: err });
            setError('Failed to load excluded IPs');
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchExcludedIps();
    }, [fetchExcludedIps]);

    const handleAddIp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newIp.trim() || !currentAccount || !token) return;

        setIsAdding(true);
        setError(null);

        try {
            const res = await fetch(`/api/accounts/${currentAccount.id}/excluded-ips`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ ip: newIp.trim() })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to add IP');
            }

            const data = await res.json();
            setExcludedIps(data.excludedIps);
            setNewIp('');
        } catch (err: any) {
            Logger.error('Failed to add excluded IP', { error: err });
            setError(err.message || 'Failed to add IP');
        } finally {
            setIsAdding(false);
        }
    };

    const handleDeleteIp = async (ip: string) => {
        if (!currentAccount || !token) return;

        setDeletingIp(ip);
        setError(null);

        try {
            const res = await fetch(`/api/accounts/${currentAccount.id}/excluded-ips/${encodeURIComponent(ip)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) throw new Error('Failed to remove IP');

            const data = await res.json();
            setExcludedIps(data.excludedIps);
        } catch (err) {
            Logger.error('Failed to remove excluded IP', { error: err });
            setError('Failed to remove IP');
        } finally {
            setDeletingIp(null);
        }
    };

    const handleAddMyIp = async () => {
        if (!currentAccount || !token) return;

        setIsDetecting(true);
        setError(null);

        try {
            // Detect current IP using a public API
            const ipRes = await fetch('https://api.ipify.org?format=json');
            if (!ipRes.ok) throw new Error('Failed to detect your IP');

            const ipData = await ipRes.json();
            const myIp = ipData.ip;

            // Add the IP
            const res = await fetch(`/api/accounts/${currentAccount.id}/excluded-ips`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ ip: myIp })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to add IP');
            }

            const data = await res.json();
            setExcludedIps(data.excludedIps);
        } catch (err: any) {
            Logger.error('Failed to add my IP', { error: err });
            setError(err.message || 'Failed to detect and add your IP');
        } finally {
            setIsDetecting(false);
        }
    };

    if (!currentAccount) return <div>Loading...</div>;

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                        <Shield className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                        <h2 className="text-lg font-medium text-gray-900">Tracking Exclusions</h2>
                        <p className="text-sm text-gray-500 mt-0.5">
                            Exclude IP addresses from live visitor tracking and analytics reports.
                        </p>
                    </div>
                </div>
            </div>

            <div className="p-6 space-y-6">
                {/* Info box */}
                <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg border border-blue-100">
                    <HelpCircle className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
                    <div className="text-sm text-blue-800">
                        <p className="font-medium mb-1">How it works</p>
                        <p className="text-blue-700">
                            Add your IP address and your team's IPs to exclude them from live visitor counts,
                            real-time logs, and analytics reports. This prevents internal traffic from skewing your data.
                            You can also use CIDR notation (e.g., <code className="px-1 py-0.5 bg-blue-100 rounded">10.0.0.0/24</code>) for IP ranges.
                        </p>
                    </div>
                </div>

                {/* Error display */}
                {error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                        {error}
                    </div>
                )}

                {/* Add IP form */}
                <form onSubmit={handleAddIp} className="flex gap-3">
                    <div className="flex-1">
                        <input
                            type="text"
                            placeholder="Enter IP address (e.g., 192.168.1.1 or 10.0.0.0/24)"
                            value={newIp}
                            onChange={(e) => setNewIp(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden font-mono text-sm"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isAdding || !newIp.trim()}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
                    >
                        {isAdding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                        Add
                    </button>
                    <button
                        type="button"
                        onClick={handleAddMyIp}
                        disabled={isDetecting}
                        className="flex items-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors font-medium disabled:opacity-50"
                    >
                        {isDetecting ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}
                        Add My IP
                    </button>
                </form>

                {/* IP list */}
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                        <h3 className="text-sm font-medium text-gray-700">Excluded IP Addresses</h3>
                    </div>

                    {isLoading ? (
                        <div className="p-8 text-center text-gray-500">
                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                            Loading...
                        </div>
                    ) : excludedIps.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            <Shield className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                            <p className="font-medium">No excluded IPs</p>
                            <p className="text-sm mt-1">Add your IP address to start filtering internal traffic.</p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {excludedIps.map((ip) => (
                                <li key={ip} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                                    <span className="font-mono text-sm text-gray-800">{ip}</span>
                                    <button
                                        onClick={() => handleDeleteIp(ip)}
                                        disabled={deletingIp === ip}
                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                                        title="Remove IP"
                                    >
                                        {deletingIp === ip ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Trash2 size={16} />
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
