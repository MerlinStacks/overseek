import { useEffect, useState } from 'react';
import { Logger } from '../../utils/logger';
import { Clock, User, Package, Bot } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { format } from 'date-fns';

interface AuditLog {
    id: string;
    action: string;
    resource: string;
    details: any;
    source?: string; // USER, SYSTEM_BOM, SYSTEM_SYNC
    previousValue?: any;
    validationStatus?: string;
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

/**
 * Displays activity history for a resource (product, order, etc.)
 * Shows both user-initiated and system-initiated (BOM) changes
 */
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
                Logger.error('Failed to fetch history', { error: error });
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

    /** Format the actor name based on source */
    const getActorDisplay = (log: AuditLog) => {
        if (log.source === 'SYSTEM_BOM') {
            return { name: 'BOM Auto-Deduct', icon: Package, isSystem: true };
        }
        if (log.source === 'SYSTEM_SYNC') {
            return { name: 'Stock Sync', icon: Bot, isSystem: true };
        }
        if (!log.user) {
            return { name: 'System', icon: Bot, isSystem: true };
        }
        return { name: log.user.fullName || log.user.email, icon: User, isSystem: false };
    };

    /** Format action description based on source and details */
    const getActionDescription = (log: AuditLog) => {
        if (log.source === 'SYSTEM_BOM' && log.details?.trigger === 'ORDER_BOM_DEDUCTION') {
            const prev = log.previousValue?.stock_quantity;
            const next = log.details.stock_quantity;
            const orderNum = log.details.orderNumber;
            return `Stock adjusted: ${prev} → ${next} (Order #${orderNum})`;
        }

        return `${log.action.toLowerCase()}d this ${log.resource.toLowerCase()}`;
    };

    /** Get timeline dot color based on source */
    const getDotColor = (log: AuditLog) => {
        if (log.source === 'SYSTEM_BOM') return 'bg-orange-100 border-orange-500';
        if (log.source === 'SYSTEM_SYNC') return 'bg-purple-100 border-purple-500';
        return 'bg-blue-100 border-blue-500';
    };

    return (
        <div className="space-y-6">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Activity History</h3>
            <div className="relative border-l border-gray-200 ml-3 space-y-8">
                {logs.map((log) => {
                    const actor = getActorDisplay(log);
                    const ActorIcon = actor.icon;

                    return (
                        <div key={log.id} className="relative pl-8">
                            {/* Timeline Dot */}
                            <div className={`absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border-2 ${getDotColor(log)}`}></div>

                            <div className="bg-white p-4 rounded-lg border border-gray-100 shadow-xs">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${actor.isSystem ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500'}`}>
                                            <ActorIcon size={14} />
                                        </div>
                                        <span className="font-medium text-gray-900 text-sm">
                                            {actor.name}
                                        </span>
                                        <span className="text-gray-400 text-xs">•</span>
                                        <span className="text-xs text-gray-500">{getActionDescription(log)}</span>
                                    </div>
                                    <span className="text-xs text-gray-400 font-mono">
                                        {format(new Date(log.createdAt), 'MMM d, h:mm a')}
                                    </span>
                                </div>

                                {/* BOM-specific details */}
                                {log.source === 'SYSTEM_BOM' && log.details?.trigger === 'ORDER_BOM_DEDUCTION' && (
                                    <div className="mt-3 bg-orange-50/50 rounded-sm p-3 text-xs">
                                        <div className="flex flex-wrap gap-4 text-gray-600">
                                            <span><strong>Qty Sold:</strong> {log.details.quantitySold}</span>
                                            <span><strong>BOM Multiplier:</strong> {log.details.bomItemQty}x</span>
                                            <span><strong>Deducted:</strong> {log.details.deductionQty}</span>
                                        </div>
                                        {log.validationStatus === 'MISMATCH_OVERRIDE' && (
                                            <div className="mt-2 text-orange-600 font-medium">
                                                ⚠️ Stock mismatch detected - change was applied anyway
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Generic changes display for non-BOM entries */}
                                {log.source !== 'SYSTEM_BOM' && log.details && Object.keys(log.details).length > 0 && (
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
                    );
                })}
            </div>
        </div>
    );
}
