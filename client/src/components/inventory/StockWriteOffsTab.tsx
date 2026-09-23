import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { StockSyncBadge, StockWriteOffEditor, writeOffButton, writeOffInput } from './StockWriteOffEditor';
import { reasons, writeOffCsv, type WriteOff, type WriteOffList, type WriteOffRequest } from './stockWriteOffs';

/** Keying the entire workspace prevents even one render of the previous tenant's data/editor. */
export function StockWriteOffsTab() {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const { hasPermission } = usePermissions();
    if (!hasPermission('manage_inventory') || !hasPermission('view_cogs')) return <p>You need inventory management and COGS access to view stock write-offs.</p>;
    if (!currentAccount || !token) return null;
    return <WriteOffWorkspace key={`${currentAccount.id}:${token}`} accountId={currentAccount.id} token={token} currency={currentAccount.currency || 'USD'} />;
}

function WriteOffWorkspace({ accountId, token, currency }: { accountId: string; token: string; currency: string }) {
    const lifetime = useRef<AbortController | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        return () => { controller.abort(); };
    }, []);
    const request: WriteOffRequest = useCallback(async <T,>(path: string, method = 'GET', body?: unknown): Promise<T> => {
        const signal = lifetime.current?.signal;
        if (!signal || signal.aborted) throw new Error('Account changed. Reopen the write-off.');
        const response = await fetch(`/api/inventory/write-offs${path}`, {
            method, signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        const data = await response.json();
        // Some transports/mocks resolve after abort; never let those results update UI or trigger downloads.
        if (signal.aborted) throw new Error('Account changed. Reopen the write-off.');
        if (!response.ok) throw new Error(data.error || 'Stock write-off request failed');
        return data as T;
    }, [accountId, token]);
    const [status, setStatus] = useState('');
    const [reason, setReason] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [page, setPage] = useState(1);
    const [revision, setRevision] = useState(0);
    const [data, setData] = useState<WriteOffList | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const [opening, setOpening] = useState(false);
    const [editor, setEditor] = useState<{ initial: WriteOff | null } | null>(null);
    const invalidDates = !!(from && to && from > to);
    useEffect(() => {
        let active = true;
        setData(null); setError(''); setLoading(true);
        if (invalidDates) { setLoading(false); return; }
        const params = new URLSearchParams({ page: String(page) });
        Object.entries({ status, reason, from, to }).forEach(([key, value]) => { if (value) params.set(key, value); });
        request<WriteOffList>(`?${params}`).then(result => {
            if (!active) return;
            const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
            if (page > lastPage) setPage(lastPage);
            else setData(result);
        }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [request, status, reason, from, to, page, revision, invalidDates]);
    const changed = () => setRevision(v => v + 1);
    async function open(id: string) {
        setOpening(true); setError('');
        try { setEditor({ initial: await request<WriteOff>(`/${encodeURIComponent(id)}`) }); }
        catch (e) { setError((e as Error).message); } finally { setOpening(false); }
    }
    async function exportCsv() {
        setExporting(true); setError('');
        try {
            const csv = await writeOffCsv(request, { reason, from, to }, currency);
            if (lifetime.current?.signal.aborted) return;
            const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
            const link = document.createElement('a');
            link.href = url; link.download = `stock-write-offs-${from || 'all'}-${to || 'dates'}.csv`;
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) { setError((e as Error).message); } finally { setExporting(false); }
    }
    return <section aria-label="Stock write-offs" className="space-y-4 text-slate-900 dark:text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Stock write-offs</h2><p className="text-sm text-slate-500 dark:text-slate-400">Record inventory losses with a draft, then finalize.</p></div><div className="flex flex-wrap gap-2">
            <button className={writeOffButton} disabled={opening} onClick={() => setEditor({ initial: null })}>New write-off</button>
            <button className={writeOffButton} disabled={exporting || invalidDates} onClick={exportCsv}>{exporting ? 'Exporting…' : 'Export finalized CSV'}</button>
            <button className={writeOffButton} disabled={loading} onClick={changed}>Refresh</button>
        </div></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label>Status<select className={writeOffInput} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="FINALIZED">Finalized</option></select></label>
            <label>Filter reason<select className={writeOffInput} value={reason} onChange={e => { setReason(e.target.value); setPage(1); }}><option value="">All reasons</option>{Object.entries(reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Finalized from (UTC)<input type="date" className={writeOffInput} value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
            <label>Finalized to (UTC)<input type="date" className={writeOffInput} value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Dates are inclusive UTC finalization dates and exclude drafts. CSV includes all finalized lines matching reason/dates, regardless of the status filter.</p>
        {invalidDates && <p role="alert">From date must be on or before to date.</p>}
        {error && <p role="alert" className="text-red-600 dark:text-red-400">{error} <button className="underline" onClick={changed}>Retry list</button></p>}
        {loading && <p role="status">Loading write-offs…</p>}
        {opening && <p role="status">Opening write-off…</p>}
        {data && <>
            <div className="grid gap-3 sm:grid-cols-3">{[
                ['Finalized loss', formatCurrency(data.summary.totalCost, currency)], ['Units written off', data.summary.quantity.toLocaleString()], ['Finalized write-offs', data.summary.count.toLocaleString()]
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-800/80"><p className="text-sm">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}</div>
            <p className="text-xs">Finalized totals across all pages matching the selected filters.</p>
            {data.items.length === 0 ? <p className="py-8 text-center">No write-offs match these filters.</p> : <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"><table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800"><tr>{['Reference', 'Status / sync', 'Reason', 'Date', `Loss (${currency})`, 'Action'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
                <tbody>{data.items.map(doc => <tr key={doc.id} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="p-3 break-all">{doc.reference}</td><td className="p-3"><p>{doc.status === 'DRAFT' ? 'Draft' : 'Finalized'}</p><StockSyncBadge status={doc.syncStatus} /></td><td className="p-3">{reasons[doc.reason]}</td>
                    <td className="p-3 whitespace-nowrap">{formatDateTime(doc.finalizedAt || doc.createdAt)}<p className="text-xs">{doc.finalizedAt ? 'Finalized' : 'Created'}</p></td><td className="p-3 whitespace-nowrap">{formatCurrency(doc.totalCost, currency)}{doc.status === 'DRAFT' && <p className="text-xs">Estimate</p>}</td>
                    <td className="p-3"><button className={writeOffButton} disabled={opening} onClick={() => open(doc.id)} aria-label={`${doc.status === 'DRAFT' ? 'Edit' : 'View'} ${doc.reference}`}>{doc.status === 'DRAFT' ? 'Edit draft' : 'View'}</button></td>
                </tr>)}</tbody>
            </table></div>}
            <nav aria-label="Write-off pagination" className="flex flex-wrap items-center justify-end gap-3"><span>{data.total} write-offs · Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><button className={writeOffButton} disabled={page <= 1} onClick={() => setPage(v => v - 1)}>Previous</button><button className={writeOffButton} disabled={page * data.pageSize >= data.total} onClick={() => setPage(v => v + 1)}>Next</button></nav>
        </>}
        {editor && <StockWriteOffEditor initial={editor.initial} request={request} currency={currency} onClose={() => setEditor(null)} onChanged={changed} />}
    </section>;
}
