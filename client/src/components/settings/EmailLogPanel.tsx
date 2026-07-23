import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { CheckCircle, XCircle, ChevronDown, ChevronUp, RefreshCw, Mail, AlertTriangle, ShieldAlert, Clock3, Eye, Search, X } from 'lucide-react';
import { useToast } from '../../context/ToastContext';

interface EmailLog {
    id: string;
    to: string;
    subject: string;
    status: 'SUCCESS' | 'FAILED' | 'BOUNCED' | 'COMPLAINED' | 'SKIPPED' | 'RETRIED' | 'PENDING_RETRY';
    errorMessage?: string;
    errorCode?: string;
    source?: string;
    sourceId?: string;
    messageId?: string;
    createdAt: string;
    emailBodyExpiresAt?: string | null;
    hasStoredEmailBody?: boolean;
    trackingEvents?: Array<{
        id: string;
        eventType: 'BOUNCE' | 'COMPLAINT';
        createdAt: string;
    }>;
    emailAccount?: {
        name: string;
        email: string;
    };
}

interface EmailLogContent {
    id: string;
    subject: string;
    to: string;
    html: string;
    truncated: boolean;
    originalLength: number;
    storedAt: string | null;
    expiresAt: string | null;
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
    const toast = useToast();
    const [logs, setLogs] = useState<EmailLog[]>([]);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [contentByLogId, setContentByLogId] = useState<Record<string, EmailLogContent>>({});
    const [contentErrorByLogId, setContentErrorByLogId] = useState<Record<string, string>>({});
    const [loadingContentId, setLoadingContentId] = useState<string | null>(null);
    const [offset, setOffset] = useState(0);
    const [busyLogId, setBusyLogId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const location = useLocation();
    const navigate = useNavigate();
    const limit = 20;
    const sourceOptions = [
        { value: '', label: 'All types' },
        { value: 'AUTOMATION', label: 'Automation' },
        { value: 'CAMPAIGN', label: 'Campaign' },
        { value: 'MANUAL', label: 'Manual' },
        { value: 'REPORT', label: 'Scheduled Report' },
        { value: 'INVENTORY_ALERT', label: 'Inventory Alert' }
    ];

    const searchParams = new URLSearchParams(location.search);
    const statusFilter = searchParams.get('status') || '';
    const sourceFilter = searchParams.get('source') || '';

    const fetchLogs = useCallback(async () => {
        if (!currentAccount || !token) return;
        setIsLoading(true);

        try {
            const params = new URLSearchParams({
                limit: String(limit),
                offset: String(offset)
            });
            if (statusFilter) params.set('status', statusFilter);
            if (sourceFilter) params.set('source', sourceFilter);
            if (debouncedSearch) params.set('search', debouncedSearch);

            const res = await fetch(`/api/email/logs?${params.toString()}`, {
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
            Logger.error('Failed to fetch email logs:', { error: error });
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, debouncedSearch, offset, sourceFilter, statusFilter, token]);

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 350);
        return () => window.clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        setOffset(0);
    }, [statusFilter, sourceFilter, debouncedSearch]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    const clearFilters = () => {
        setSearchQuery('');
        setDebouncedSearch('');
        navigate('/emails/logs');
    };

    const setTypeFilter = (source: string) => {
        const params = new URLSearchParams(location.search);
        if (source) {
            params.set('source', source);
        } else {
            params.delete('source');
        }
        navigate(`/emails/logs${params.toString() ? `?${params.toString()}` : ''}`);
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString();
    };

    const getSourceLabel = (source?: string) => {
        if (!source) return null;
        const labels: Record<string, string> = {
            'AUTOMATION': 'Automation',
            'CAMPAIGN': 'Campaign',
            'REPORT': 'Scheduled Report',
            'INVENTORY_ALERT': 'Inventory Alert',
            'MANUAL': 'Manual'
        };
        return labels[source] || source;
    };

    const getStatusIcon = (status: EmailLog['status']) => {
        if (status === 'SUCCESS' || status === 'RETRIED') {
            return <CheckCircle size={18} className="text-green-500 flex-shrink-0" />;
        }
        if (status === 'BOUNCED') {
            return <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />;
        }
        if (status === 'COMPLAINED') {
            return <ShieldAlert size={18} className="text-orange-600 flex-shrink-0" />;
        }
        if (status === 'PENDING_RETRY') {
            return <Clock3 size={18} className="text-blue-500 flex-shrink-0" />;
        }
        return <XCircle size={18} className="text-red-500 flex-shrink-0" />;
    };

    const getStatusLabel = (status: EmailLog['status']) => {
        if (status === 'PENDING_RETRY') return 'QUEUED';
        return status;
    };

    const markDeliveryEvent = async (logId: string, eventType: 'BOUNCE' | 'COMPLAINT') => {
        if (!currentAccount || !token) return;
        setBusyLogId(logId);

        try {
            const res = await fetch(`/api/email/logs/${logId}/delivery-event`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({ eventType })
            });

            if (!res.ok) {
                throw new Error('Failed to record delivery event');
            }

            await fetchLogs();
        } catch (error) {
            Logger.error('Failed to record delivery event', { error, logId, eventType });
            toast.error(`Failed to mark email as ${eventType.toLowerCase()}.`);
        } finally {
            setBusyLogId(null);
        }
    };

    const retryFailedEmail = async (logId: string) => {
        if (!currentAccount || !token) return;
        setBusyLogId(logId);

        try {
            const res = await fetch(`/api/email/logs/${logId}/retry`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload.error || 'Failed to retry email');
            }

            toast.success('Retry queued');
            await fetchLogs();
        } catch (error: any) {
            toast.error(error?.message || 'Failed to retry email');
        } finally {
            setBusyLogId(null);
        }
    };

    const fetchEmailContent = async (logId: string) => {
        if (!currentAccount || !token) return;
        if (contentByLogId[logId]) return;
        setLoadingContentId(logId);
        setContentErrorByLogId((current) => ({ ...current, [logId]: '' }));

        try {
            const res = await fetch(`/api/email/logs/${logId}/content`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload.error || 'Stored email body is not available');
            }

            const content: EmailLogContent = await res.json();
            setContentByLogId((current) => ({ ...current, [logId]: content }));
        } catch (error: any) {
            setContentErrorByLogId((current) => ({
                ...current,
                [logId]: error?.message || 'Failed to load email body'
            }));
        } finally {
            setLoadingContentId(null);
        }
    };

    const clearSuppressionForRecipient = async (recipientEmail: string) => {
        if (!currentAccount || !token) return;
        const normalized = recipientEmail.trim().toLowerCase();
        if (!normalized || !confirm(`Remove suppression for ${normalized}?`)) return;

        setBusyLogId(`suppression:${normalized}`);
        try {
            const res = await fetch(`/api/email/suppressions/${encodeURIComponent(normalized)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload.error || 'Failed to remove suppression');
            }

            toast.success(`Suppression removed for ${normalized}`);
            await fetchLogs();
        } catch (error: any) {
            toast.error(error?.message || 'Failed to remove suppression');
        } finally {
            setBusyLogId(null);
        }
    };

    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;
    const queuedCount = logs.filter((log) => log.status === 'PENDING_RETRY').length;

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
                    {(statusFilter || sourceFilter || debouncedSearch) && (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                            Filtered
                        </span>
                    )}
                    {queuedCount > 0 && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            {queuedCount} queued
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {(statusFilter || sourceFilter || debouncedSearch) && (
                        <button
                            onClick={clearFilters}
                            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-100"
                        >
                            Clear filters
                        </button>
                    )}
                    <button
                        onClick={fetchLogs}
                        disabled={isLoading}
                        className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            <div className="flex flex-col gap-3 border-b border-gray-100 bg-gray-50/70 px-4 py-3 sm:flex-row sm:items-end">
                <label className="flex w-full max-w-md flex-col gap-1 text-sm">
                    <span className="font-medium text-gray-700">Search</span>
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="search"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Search recipient, subject, message ID, or error..."
                            aria-label="Search email logs"
                            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                aria-label="Clear search"
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                </label>
                <label className="flex w-full max-w-xs flex-col gap-1 text-sm">
                    <span className="font-medium text-gray-700">Type</span>
                    <select
                        value={sourceFilter}
                        onChange={(event) => setTypeFilter(event.target.value)}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    >
                        {sourceOptions.map((option) => (
                            <option key={option.value || 'all'} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            {/* Logs Table */}
            {logs.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                    <Mail size={32} className="mx-auto mb-2 opacity-50" />
                    <p>{debouncedSearch || statusFilter || sourceFilter ? 'No matching email logs' : 'No email logs yet'}</p>
                    <p className="text-sm">
                        {debouncedSearch || statusFilter || sourceFilter ? 'Try changing your search or filters' : 'Sent emails will appear here'}
                    </p>
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
                                {getStatusIcon(log.status)}

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
                                        {log.status === 'PENDING_RETRY' && (
                                            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                                                Queued
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
                                            <p className={`font-medium ${log.status === 'SUCCESS' || log.status === 'RETRIED' ? 'text-green-600' : log.status === 'BOUNCED' ? 'text-amber-600' : log.status === 'COMPLAINED' ? 'text-orange-600' : log.status === 'PENDING_RETRY' ? 'text-blue-600' : 'text-red-600'}`}>
                                                {getStatusLabel(log.status)}
                                            </p>
                                        </div>
                                        {log.trackingEvents && log.trackingEvents.length > 0 && (
                                            <div className="col-span-2">
                                                <span className="text-gray-500">Deliverability Events:</span>
                                                <div className="mt-1 flex flex-wrap gap-2">
                                                    {log.trackingEvents.map((event) => (
                                                        <span
                                                            key={event.id}
                                                            className={`rounded-full px-2 py-1 text-xs ${
                                                                event.eventType === 'COMPLAINT'
                                                                    ? 'bg-orange-100 text-orange-700'
                                                                    : 'bg-amber-100 text-amber-700'
                                                            }`}
                                                        >
                                                            {event.eventType} · {formatDate(event.createdAt)}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {log.messageId && (
                                            <div className="col-span-2">
                                                <span className="text-gray-500">Message ID:</span>
                                                <p className="font-mono text-xs break-all">{log.messageId}</p>
                                            </div>
                                        )}
                                        {log.hasStoredEmailBody && (
                                            <div className="col-span-2 rounded-lg border border-gray-200 bg-white p-3">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div>
                                                        <span className="text-gray-500">Sent Email:</span>
                                                        <p className="text-xs text-gray-500">
                                                            Stored until {log.emailBodyExpiresAt ? formatDate(log.emailBodyExpiresAt) : 'retention cleanup'}
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => fetchEmailContent(log.id)}
                                                        disabled={loadingContentId === log.id}
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                                                    >
                                                        <Eye size={14} />
                                                        {loadingContentId === log.id ? 'Loading...' : contentByLogId[log.id] ? 'Email loaded' : 'View email'}
                                                    </button>
                                                </div>

                                                {contentErrorByLogId[log.id] && (
                                                    <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                                                        {contentErrorByLogId[log.id]}
                                                    </div>
                                                )}

                                                {contentByLogId[log.id] && (
                                                    <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
                                                        {contentByLogId[log.id].truncated && (
                                                            <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                                                Preview truncated from {contentByLogId[log.id].originalLength.toLocaleString()} characters.
                                                            </div>
                                                        )}
                                                        <iframe
                                                            title={`Sent email preview: ${log.subject}`}
                                                            sandbox=""
                                                            srcDoc={contentByLogId[log.id].html}
                                                            className="h-[520px] w-full bg-white"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {log.errorMessage && (
                                            <div className="col-span-2">
                                                <span className="text-gray-500">Error:</span>
                                                <div className={`mt-1 p-2 rounded border ${log.status === 'PENDING_RETRY' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                                                    {log.errorCode && (
                                                        <span className="font-mono text-xs mr-2">[{log.errorCode}]</span>
                                                    )}
                                                    {log.errorMessage}
                                                </div>
                                            </div>
                                        )}
                                        {log.status === 'SUCCESS' && (
                                            <div className="col-span-2 flex flex-wrap gap-2 pt-2">
                                                <button
                                                    onClick={() => markDeliveryEvent(log.id, 'BOUNCE')}
                                                    disabled={busyLogId === log.id}
                                                    className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-50"
                                                >
                                                    Mark Bounce
                                                </button>
                                                <button
                                                    onClick={() => markDeliveryEvent(log.id, 'COMPLAINT')}
                                                    disabled={busyLogId === log.id}
                                                    className="rounded-lg border border-orange-300 px-3 py-1.5 text-sm text-orange-700 transition-colors hover:bg-orange-50 disabled:opacity-50"
                                                >
                                                    Mark Complaint
                                                </button>
                                            </div>
                                        )}
                                        {log.status === 'FAILED' && (
                                            <div className="col-span-2 flex flex-wrap gap-2 pt-2">
                                                <button
                                                    onClick={() => retryFailedEmail(log.id)}
                                                    disabled={busyLogId === log.id}
                                                    className="rounded-lg border border-blue-300 px-3 py-1.5 text-sm text-blue-700 transition-colors hover:bg-blue-50 disabled:opacity-50"
                                                >
                                                    Retry send
                                                </button>
                                            </div>
                                        )}
                                        {log.status === 'SKIPPED' && log.errorMessage?.toLowerCase().includes('recipient is unsubscribed') && (
                                            <div className="col-span-2 flex flex-wrap gap-2 pt-2">
                                                <button
                                                    onClick={() => clearSuppressionForRecipient(log.to)}
                                                    disabled={busyLogId === `suppression:${log.to.trim().toLowerCase()}`}
                                                    className="rounded-lg border border-indigo-300 px-3 py-1.5 text-sm text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-50"
                                                >
                                                    Re-subscribe recipient
                                                </button>
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
