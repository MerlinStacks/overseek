import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, ChevronDown, ChevronUp, Clock3, MessageSquareText, RefreshCw, Search, X, XCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Logger } from '../../utils/logger';

interface SmsLog {
    id: string;
    to: string;
    from?: string;
    body: string;
    status: string;
    errorMessage?: string;
    errorCode?: string;
    source?: string;
    sourceId?: string;
    messageId?: string;
    segments?: number;
    price?: string;
    priceUnit?: string;
    statusAt?: string;
    createdAt: string;
}

interface SmsLogsResponse {
    logs: SmsLog[];
    total: number;
}

const statusOptions = ['', 'FAILED', 'QUEUED', 'SENT', 'DELIVERED', 'UNDELIVERED'];
const sourceOptions = [
    { value: '', label: 'All types' },
    { value: 'INBOX', label: 'Inbox' },
    { value: 'MANUAL', label: 'Manual' },
    { value: 'AUTOMATION', label: 'Automation' }
];

export function SmsLogPanel() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [logs, setLogs] = useState<SmsLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [status, setStatus] = useState('');
    const [source, setSource] = useState('');
    const [offset, setOffset] = useState(0);
    const limit = 20;

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
        return () => window.clearTimeout(timer);
    }, [search]);

    useEffect(() => setOffset(0), [debouncedSearch, source, status]);

    const fetchLogs = useCallback(async () => {
        if (!token || !currentAccount) return;
        setLoading(true);
        setError('');
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (status) params.set('status', status);
        if (source) params.set('source', source);

        try {
            const response = await fetch(`/api/sms/logs?${params}`, {
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount.id }
            });
            if (!response.ok) throw new Error('Failed to load SMS logs');
            const data: SmsLogsResponse = await response.json();
            setLogs(data.logs);
            setTotal(data.total);
        } catch (fetchError) {
            Logger.error('Failed to fetch SMS logs', { error: fetchError });
            setError('SMS logs could not be loaded.');
        } finally {
            setLoading(false);
        }
    }, [currentAccount, debouncedSearch, offset, source, status, token]);

    useEffect(() => { void fetchLogs(); }, [fetchLogs]);

    const statusIcon = (value: string) => {
        if (value === 'DELIVERED') return <CheckCircle size={18} className="shrink-0 text-green-500" />;
        if (value === 'FAILED' || value === 'UNDELIVERED') return <XCircle size={18} className="shrink-0 text-red-500" />;
        return <Clock3 size={18} className="shrink-0 text-blue-500" />;
    };
    const statusColour = (value: string) => value === 'DELIVERED'
        ? 'text-green-700 bg-green-50'
        : value === 'FAILED' || value === 'UNDELIVERED'
            ? 'text-red-700 bg-red-50'
            : 'text-blue-700 bg-blue-50';
    const clearFilters = () => {
        setSearch('');
        setStatus('');
        setSource('');
    };
    const page = Math.floor(offset / limit) + 1;
    const pages = Math.max(1, Math.ceil(total / limit));

    return (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
                <div className="flex items-center gap-2">
                    <MessageSquareText size={18} className="text-gray-500" />
                    <h2 className="font-medium text-gray-900">Twilio SMS Logs</h2>
                    <span className="text-sm text-gray-500">({total} total)</span>
                </div>
                <button onClick={() => void fetchLogs()} disabled={loading} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" title="Refresh">
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            <div className="grid gap-3 border-b border-gray-100 bg-gray-50/70 px-4 py-3 sm:grid-cols-[minmax(12rem,1fr)_11rem_11rem_auto] sm:items-end">
                <label className="text-sm">
                    <span className="mb-1 block font-medium text-gray-700">Search</span>
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Number, message, SID, or error..." className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-9" />
                        {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400"><X size={14} /></button>}
                    </div>
                </label>
                <label className="text-sm">
                    <span className="mb-1 block font-medium text-gray-700">Status</span>
                    <select value={status} onChange={event => setStatus(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                        {statusOptions.map(value => <option key={value || 'all'} value={value}>{value || 'All statuses'}</option>)}
                    </select>
                </label>
                <label className="text-sm">
                    <span className="mb-1 block font-medium text-gray-700">Type</span>
                    <select value={source} onChange={event => setSource(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                        {sourceOptions.map(option => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
                    </select>
                </label>
                <button onClick={clearFilters} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-white">Clear</button>
            </div>

            {error ? <div className="p-6 text-center text-red-600">{error}</div> : loading && logs.length === 0 ? (
                <div className="flex items-center gap-2 p-6 text-gray-500"><RefreshCw size={16} className="animate-spin" /> Loading SMS logs...</div>
            ) : logs.length === 0 ? (
                <div className="p-8 text-center text-gray-500"><MessageSquareText size={32} className="mx-auto mb-2 opacity-50" /><p>No SMS logs found</p></div>
            ) : (
                <div className="divide-y divide-gray-100">
                    {logs.map(log => (
                        <div key={log.id}>
                            <button onClick={() => setExpandedId(expandedId === log.id ? null : log.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
                                {statusIcon(log.status)}
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium text-gray-900">{log.to}</span>
                                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColour(log.status)}`}>{log.status}</span>
                                        {log.source && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{log.source}</span>}
                                    </div>
                                    <p className="truncate text-sm text-gray-500">{log.body}</p>
                                </div>
                                <span className="hidden shrink-0 text-xs text-gray-400 sm:block">{new Date(log.createdAt).toLocaleString()}</span>
                                {expandedId === log.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                            {expandedId === log.id && (
                                <div className="space-y-3 border-t border-gray-100 bg-gray-50 px-4 py-4 text-sm">
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                        <div><span className="text-gray-500">From</span><p className="font-medium">{log.from || 'Not available'}</p></div>
                                        <div><span className="text-gray-500">Twilio SID</span><p className="break-all font-mono text-xs">{log.messageId || 'Not assigned'}</p></div>
                                        <div><span className="text-gray-500">Segments</span><p className="font-medium">{log.segments ?? 'Unknown'}</p></div>
                                        <div><span className="text-gray-500">Last status update</span><p>{new Date(log.statusAt || log.createdAt).toLocaleString()}</p></div>
                                    </div>
                                    <div><span className="text-gray-500">Message</span><p className="mt-1 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-gray-800">{log.body}</p></div>
                                    {(log.errorMessage || log.errorCode) && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700"><strong>Error {log.errorCode ? `(${log.errorCode})` : ''}:</strong> {log.errorMessage || 'Twilio reported a delivery failure'}</div>}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm">
                <span className="text-gray-500">Page {page} of {pages}</span>
                <div className="flex gap-2">
                    <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Previous</button>
                    <button disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Next</button>
                </div>
            </div>
        </div>
    );
}
