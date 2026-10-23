import { useLayoutEffect, useRef, useState } from 'react';
import { Plus, Search, Tag, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useRecoveryAttempt } from '../../hooks/useRecoveryAttempt';
import { isRecord } from '../../utils/responseValidation';
import { emitCrossTabEvent } from '../../utils/productCrossTabEvents';
interface Props { orderId: string; currentTags: string[]; lastUpdate?: string; onTagsChange: (tags: string[]) => void; onRefresh?: () => void }
interface Mapping { orderTag: string; enabled: boolean; color?: string }
const tagsValid = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(tag => typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 100) && new Set(value.map(tag => tag.toLowerCase())).size === value.length;
const versionValid = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
function decode(value: unknown): Mapping[] {
    if (!isRecord(value) || !Array.isArray(value.mappings) || value.mappings.length > 500 || value.mappings.some(row => !isRecord(row) || typeof row.orderTag !== 'string' || !row.orderTag.trim() || row.orderTag.length > 100 || typeof row.enabled !== 'boolean' || row.color !== undefined && (typeof row.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(row.color)))) throw new Error('Invalid mappings');
    const seen = new Set<string>(); return (value.mappings as Mapping[]).filter(row => { const key = row.orderTag.toLowerCase(); if (!row.enabled || seen.has(key)) return false; seen.add(key); return true; });
}
export function OrderTagPanel(props: Props) {
    const { token, user } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p>Select an account and sign in.</p>;
    if (!tagsValid(props.currentTags)) return <p role="alert">Order tags unavailable; refresh the order.</p>;
    return <ScopedTags key={JSON.stringify([user?.id, token, currentAccount.id, props.orderId])} {...props} accountId={currentAccount.id} token={token} />;
}
function ScopedTags({ accountId, token, orderId, currentTags, lastUpdate, onTagsChange, onRefresh }: Props & { accountId: string; token: string }) {
    const mappings = useScopedRequest(`/api/accounts/${encodeURIComponent(accountId)}/tag-mappings`, accountId, token, decode);
    const attempt = useRecoveryAttempt(); const { hasPermission } = usePermissions();
    const latestPropVersion = useRef(lastUpdate);
    useLayoutEffect(() => { latestPropVersion.current = lastUpdate; }, [lastUpdate]);
    const [ack, setAck] = useState<{ tags: string[]; version: string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [search, setSearch] = useState(''), [expanded, setExpanded] = useState(false);
    // Never regress to the pre-mutation prop version; newer authoritative props win.
    const useAck = ack && (!versionValid(lastUpdate) || Date.parse(ack.version) >= Date.parse(lastUpdate));
    const tags = useAck ? ack.tags : currentTags, version = useAck ? ack.version : lastUpdate;
    const allowed = hasPermission('edit_order_tags') && versionValid(version) && !busy && !error;
    async function write(tag: string, remove = false) {
        if (!allowed || !versionValid(version)) return;
        const active = attempt.begin(); if (!active) return; setBusy(true); setExpanded(false);
        const timer = setTimeout(() => active.abort(), 30000);
        try {
            const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/tags${remove ? `/${encodeURIComponent(tag)}` : ''}`, { method: remove ? 'DELETE' : 'POST', signal: active.signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'X-Order-Version': version, 'Content-Type': 'application/json' }, ...(!remove ? { body: JSON.stringify({ tag }) } : {}) });
            const result = await response.json();
            if (!response.ok || !isRecord(result) || !tagsValid(result.tags) || !versionValid(result.updatedAt) || Date.parse(result.updatedAt) <= Date.parse(version) || result.indexing !== 'pending') throw new Error('Unacknowledged');
            if (!attempt.current(active)) return;
            if (versionValid(latestPropVersion.current) && Date.parse(latestPropVersion.current) > Date.parse(result.updatedAt)) {
                setError('A newer order version arrived while saving. Refresh to reconcile; the newer tags were not replaced.'); return;
            }
            setAck({ tags: result.tags, version: result.updatedAt }); onTagsChange(result.tags);
            emitCrossTabEvent({ resource: 'order', type: 'tags-updated', accountId, resourceId: orderId });
        } catch { if (attempt.current(active, true)) setError('Tag write not acknowledged or order changed. It may have committed. Refresh the order and reconcile before further writes.'); }
        finally { clearTimeout(timer); attempt.finish(); if (attempt.current(active, true)) setBusy(false); }
    }
    const options = (mappings.data || []).filter(row => !tags.some(tag => tag.toLowerCase() === row.orderTag.toLowerCase()) && row.orderTag.toLowerCase().includes(search.toLowerCase()));
    const controlClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[var(--focus-color)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';
    return <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-700 dark:bg-slate-800 space-y-3 text-sm text-slate-900 dark:text-slate-100"><h3 className="flex items-center gap-2 font-semibold"><Tag size={18} className="text-[var(--brand-text)]" />Tags</h3>
        {error && <p role="alert">{error} <button onClick={() => window.location.reload()}>Reload page after reconciliation</button></p>}
        {!versionValid(version) && <p role="status">Current order version required before editing.</p>}
        {useAck && <p role="status">Tags saved locally; search indexing pending.</p>}
        {(error || !versionValid(version)) && onRefresh && <button type="button" className={controlClass} onClick={onRefresh}>Refresh order to reconcile</button>}
        {tags.length === 0 && <p className="text-xs italic text-slate-500 dark:text-slate-400">No tags applied.</p>}
        <ul className="flex flex-wrap gap-2">{tags.map(tag => { const color = mappings.data?.find(row => row.orderTag.toLowerCase() === tag.toLowerCase())?.color; return <li key={tag} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--brand-border)] bg-[var(--brand-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--brand-text)]">{color && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}<span className="min-w-0 break-all">{tag}</span>{hasPermission('edit_order_tags') && <button type="button" className="shrink-0 rounded-full p-0.5 hover:bg-[var(--brand-subtle)] focus-visible:outline-2 focus-visible:outline-[var(--focus-color)] disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Remove tag ${tag}`} disabled={!allowed} onClick={() => void write(tag, true)}><X size={12} /></button>}</li>; })}</ul>
        {mappings.loading ? <p role="status">Loading tag mappings…</p> : mappings.error ? <p role="alert">Tag mappings unavailable. <button onClick={mappings.retry}>Retry tag mappings</button></p> : hasPermission('edit_order_tags') && <>
            <button type="button" className={controlClass} aria-expanded={expanded} disabled={!allowed} onClick={() => setExpanded(value => !value)}><Plus size={14} />Add tag</button>
            {expanded && <div className="overflow-hidden rounded-lg border border-slate-200 shadow-sm dark:border-slate-600" onKeyDown={event => { if (event.key === 'Escape') setExpanded(false); }}><label className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-700"><Search size={14} className="shrink-0 text-slate-400" /><span className="sr-only">Search tags</span><input className="block min-w-0 w-full bg-transparent text-xs outline-none" placeholder="Search tags…" value={search} onChange={event => setSearch(event.target.value)} maxLength={100} /></label><div className="max-h-48 overflow-y-auto p-1">{options.length === 0 ? <p className="p-2 text-xs text-slate-500 dark:text-slate-400">No available matching tags.</p> : options.map(row => <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-700" disabled={!allowed} key={row.orderTag} onClick={() => void write(row.orderTag)}>{row.color && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />}<span className="break-all">{row.orderTag}</span></button>)}</div></div>}
        </>}
    </section>;
}
