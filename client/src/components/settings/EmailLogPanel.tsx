import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { CheckCircle, XCircle, ChevronDown, ChevronUp, RefreshCw, Mail } from 'lucide-react';

interface EmailLog {
    id: string;
    to: string;
    subject: string;
    status: 'SUCCESS' | 'FAILED';
    errorMessage?: string;
    errorCode?: string;
    source?: string;
    sourceId?: string;
    messageId?: string;
    createdAt: string;
    emailAccount?: {
        name: string;
        email: string;
    };
}

interface EmailLogsResponse {
    logs: EmailLog[];
    total: number;
    limit: number;
    offset: number;
}

export function EmailLogPanel() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [logs, setLogs] = useState<EmailLog[]>([]);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [offset, setOffset] = useState(0);
    const limit = 20;

    const fetchLogs = async () => {
        if (!currentAccount || !token) return;
        setIsLoading(true);

        try {
            const res = await fetch(`/api/email/logs?limit=${limit}&offset=${offset}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            if (res.ok) {
                const data: EmailLogsResponse = await res.json();
                setLogs(data.logs);
                setTotal(data.total);
            }
        } catch (error) {
            console.error('Failed to fetch email logs:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [currentAccount, token, offset]);

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString();
    };

    const getSourceLabel = (source?: string) => {
        if (!source) return null;
        const labels: Record<string, string> = {
            'AUTOMATION': 'Automation',
            'REPORT': 'Scheduled Report',
            'INVENTORY_ALERT': 'Inventory Alert',
            'MANUAL': 'Manual'
        };
        return labels[source] || source;
    };

    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;

    if (isLoading && logs.length === 0) {
        return (
            <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-6">
                <div className="flex items-center gap-2 text-gray-500">
                    <RefreshCw size={16} className="animate-spin" />
                    <span>Loading email logs...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Mail size={18} className="text-gray-500" />
                    <h3 className="font-medium text-gray-900">Email Logs</h3>
                    <span className="text-sm text-gray-500">({total} total)</span>
                </div>
                <button
                    onClick={fetchLogs}
                    disabled={isLoading}
                    className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Refresh"
                >
                    <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Logs Table */}
            {logs.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                    <Mail size={32} className="mx-auto mb-2 opacity-50" />
                    <p>No email logs yet</p>
                    <p className="text-sm">Sent emails will appear here</p>
                </div>
            ) : (
                <div className="divide-y divide-gray-100">
                    {logs.map((log) => (
                        <div key={log.id} className="hover:bg-gray-50 transition-colors">
                            {/* Main Row */}
                            <div
                                className="px-4 py-3 flex items-center gap-4 cursor-pointer"
                                onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                            >
                                {/* Status Icon */}
                                {log.status === 'SUCCESS' ? (
                                    <CheckCircle size={18} className="text-green-500 flex-shrink-0" />
                                ) : (
                                    <XCircle size={18} className="text-red-500 flex-shrink-0" />
                                )}

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-gray-900 truncate">
                                            {log.to}
                                        </span>
                                        {log.source && (
                                            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                                                {getSourceLabel(log.source)}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-500 truncate">{log.subject}</p>
                                </div>

                                {/* Timestamp */}
                                <span className="text-xs text-gray-400 flex-shrink-0">
                                    {formatDate(log.createdAt)}
                                </span>

                                {/* Expand Icon */}
                                {expandedId === log.id ? (
                                    <ChevronUp size={16} className="text-gray-400" />
                                ) : (
                                    <ChevronDown size={16} className="text-gray-400" />
                                )}
                            </div>

                            {/* Expanded Details */}
                            {expandedId === log.id && (
                                <div className="px-4 pb-4 pt-1 bg-gray-50 border-t border-gray-100">
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <span className="text-gray-500">From Account:</span>
                                            <p className="font-medium">
                                                {log.emailAccount?.name || 'Unknown'} ({log.emailAccount?.email || 'N/A'})
                                            </p>
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Status:</span>
                                            <p className={`font-medium ${log.status === 'SUCCESS' ? 'text-green-600' : 'text-red-600'}`}>
                                                {log.status}
                                            </p>
                                        </div>
                                        {log.messageId && (
                                            <div className="col-span-2">
                                                <span className="text-gray-500">Message ID:</span>
                                                <p className="font-mono text-xs break-all">{log.messageId}</p>
                                            </div>
                                        )}
                                        {log.errorMessage && (
                                            <div className="col-span-2">
                                                <span className="text-gray-500">Error:</span>
                                                <div className="mt-1 p-2 bg-red-50 border border-red-200 rounded text-red-700">
                                                    {log.errorCode && (
                                                        <span className="font-mono text-xs mr-2">[{log.errorCode}]</span>
                                                    )}
                                                    {log.errorMessage}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                    <span className="text-sm text-gray-500">
                        Page {currentPage} of {totalPages}
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setOffset(Math.max(0, offset - limit))}
                            disabled={offset === 0}
                            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Previous
                        </button>
                        <button
                            onClick={() => setOffset(offset + limit)}
                            disabled={offset + limit >= total}
                            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
