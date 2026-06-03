import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Mail, ShieldAlert, XCircle } from 'lucide-react';
import { WidgetProps } from './WidgetRegistry';
import { WidgetEmptyState, WidgetErrorState, WidgetLoadingState } from './WidgetState';
import { widgetCardClass, widgetHeaderIconBadgeClass, widgetHeaderRowClass, widgetListRowClass, widgetSubtleTextClass, widgetTitleClass } from './widgetStyles';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { RelativeTime } from '../ui/RelativeTime';
import { Logger } from '../../utils/logger';

type EmailLogStatus = 'SUCCESS' | 'FAILED' | 'BOUNCED' | 'COMPLAINED' | 'SKIPPED' | 'RETRIED' | 'PENDING_RETRY';

interface EmailLog {
    id: string;
    to: string;
    subject: string;
    status: EmailLogStatus;
    source?: string;
    createdAt: string;
}

interface EmailLogsResponse {
    logs: EmailLog[];
    total: number;
}

function getStatusMeta(status: EmailLogStatus) {
    if (status === 'SUCCESS' || status === 'RETRIED') {
        return {
            label: status === 'RETRIED' ? 'RETRIED' : 'SENT',
            icon: CheckCircle,
            className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
        };
    }

    if (status === 'BOUNCED') {
        return {
            label: 'BOUNCED',
            icon: AlertTriangle,
            className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
        };
    }

    if (status === 'COMPLAINED') {
        return {
            label: 'COMPLAINT',
            icon: ShieldAlert,
            className: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300'
        };
    }

    return {
        label: status === 'PENDING_RETRY' ? 'QUEUED' : status,
        icon: XCircle,
        className: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
    };
}

function formatSource(source?: string) {
    if (!source) return 'Email';
    return source.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function EmailLogWidget({ className }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [logs, setLogs] = useState<EmailLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const fetchAbortRef = useRef<AbortController | null>(null);

    const fetchLogs = useCallback(async () => {
        if (!currentAccount || !token) return;

        fetchAbortRef.current?.abort();
        const controller = new AbortController();
        fetchAbortRef.current = controller;

        setLoading(true);
        try {
            const res = await fetch('/api/email/logs?limit=6&offset=0', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                signal: controller.signal
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data: EmailLogsResponse = await res.json();
            if (controller.signal.aborted) return;

            setLogs(Array.isArray(data.logs) ? data.logs : []);
            setTotal(data.total || 0);
            setError(null);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            Logger.error('Failed to fetch email log widget data', { error: err });
            setError('Failed to load email logs');
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false);
            }
        }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchLogs();
        return () => {
            fetchAbortRef.current?.abort();
        };
    }, [fetchLogs]);

    const issueCount = logs.filter((log) => ['FAILED', 'BOUNCED', 'COMPLAINED'].includes(log.status)).length;

    return (
        <div className={`${widgetCardClass} h-full w-full p-5 flex flex-col overflow-hidden ${className || ''}`}>
            <div className={widgetHeaderRowClass}>
                <div>
                    <h3 className={widgetTitleClass}>Email Log</h3>
                    <p className={widgetSubtleTextClass}>{total} total logged</p>
                </div>
                <div className="flex items-center gap-2">
                    {issueCount > 0 && (
                        <Link
                            to="/emails/logs?status=FAILED,BOUNCED,COMPLAINED"
                            className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
                        >
                            {issueCount} issue{issueCount === 1 ? '' : 's'}
                        </Link>
                    )}
                    <div className={`${widgetHeaderIconBadgeClass} bg-gradient-to-br from-indigo-500 to-violet-600 shadow-indigo-500/20`}>
                        <Mail size={16} />
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
                {loading ? (
                    <WidgetLoadingState message="Loading email logs..." />
                ) : error ? (
                    <WidgetErrorState message={error} onRetry={fetchLogs} />
                ) : logs.length === 0 ? (
                    <WidgetEmptyState message="No email logs yet" />
                ) : (
                    logs.map((log) => {
                        const status = getStatusMeta(log.status);
                        const StatusIcon = status.icon;

                        return (
                            <Link
                                key={log.id}
                                to="/emails/logs"
                                className={`block ${widgetListRowClass} hover:bg-slate-50 dark:hover:bg-slate-700/50`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{log.subject || '(No subject)'}</p>
                                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{log.to}</p>
                                        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                                            {formatSource(log.source)} &middot; <RelativeTime date={log.createdAt} className="text-xs text-slate-400 dark:text-slate-500" />
                                        </p>
                                    </div>
                                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${status.className}`}>
                                        <StatusIcon size={12} />
                                        {status.label}
                                    </span>
                                </div>
                            </Link>
                        );
                    })
                )}
            </div>

            {!loading && !error && logs.length > 0 && (
                <Link to="/emails/logs" className="mt-3 text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">
                    View all email logs
                </Link>
            )}
        </div>
    );
}
