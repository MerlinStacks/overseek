import { useEffect, useState } from 'react';
import { Clock, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { format } from 'date-fns';

interface AuditLog {
    id: string;
    action: string;
    resource: string;
    details: any;
    createdAt: string;
    user: {
        fullName: string | null;
        email: string;
    } | null;
}

interface HistoryTimelineProps {
    resource: string;
    resourceId: string;
}

export function HistoryTimeline({ resource, resourceId }: HistoryTimelineProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentAccount || !token) return;

        const fetchLogs = async () => {
            try {
                const res = await fetch(`/api/audits/${resource}/${resourceId}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id
                    }
                });
                if (res.ok) {
                    setLogs(await res.json());
                }
            } catch (error) {
                console.error('Failed to fetch history', error);
            } finally {
                setLoading(false);
            }
        };

        fetchLogs();
    }, [resource, resourceId, currentAccount, token]);

    if (loading) return <div className="p-4 text-center text-gray-500">Loading history...</div>;

    if (logs.length === 0) {
        return (
            <div className="p-8 text-center text-gray-400">
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No history available for this item yet.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Activity History</h3>
            <div className="relative border-l border-gray-200 ml-3 space-y-8">
                {logs.map((log) => (
                    <div key={log.id} className="relative pl-8">
                        {/* Timeline Dot */}
                        <div className="absolute -left-1.5 top-1.5 w-3 h-3 rounded-full bg-blue-100 border-2 border-blue-500"></div>

                        <div className="bg-white p-4 rounded-lg border border-gray-100 shadow-xs">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
                                        <User size={14} />
                                    </div>
                                    <span className="font-medium text-gray-900 text-sm">
                                        {log.user?.fullName || log.user?.email || 'System'}
                                    </span>
                                    <span className="text-gray-400 text-xs">•</span>
                                    <span className="text-xs text-gray-500 capitalize">{log.action.toLowerCase()}d this {log.resource.toLowerCase()}</span>
                                </div>
                                <span className="text-xs text-gray-400 font-mono">
                                    {format(new Date(log.createdAt), 'MMM d, h:mm a')}
                                </span>
                            </div>

                            {/* Changes Diff */}
                            {log.details && Object.keys(log.details).length > 0 && (
                                <div className="mt-3 bg-gray-50/50 rounded-sm p-3 text-xs font-mono text-gray-600">
                                    {Object.entries(log.details).map(([key, value]) => (
                                        <div key={key} className="flex gap-2">
                                            <span className="font-semibold text-gray-700">{key}:</span>
                                            <span className="truncate max-w-xs">{JSON.stringify(value)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
