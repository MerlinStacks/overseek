import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useRecoveryAttempt } from '../../hooks/useRecoveryAttempt';
import { isRecord } from '../../utils/responseValidation';
interface Mapping { productTags: string[]; orderTag: string; enabled: boolean; color?: string }
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
function snapshot(value: unknown): { mappings: Mapping[]; version: string } {
    if (!isRecord(value) || !Array.isArray(value.mappings) || value.mappings.length > 500 || typeof value.version !== 'string' || !Number.isFinite(Date.parse(value.version))) throw new Error('Invalid mappings snapshot');
    const mappings = value.mappings.map(row => {
        if (!isRecord(row) || !text(row.orderTag) || typeof row.enabled !== 'boolean' || !Array.isArray(row.productTags) || !row.productTags.length || row.productTags.length > 100 || !row.productTags.every(text) || row.color !== undefined && (typeof row.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(row.color))) throw new Error('Invalid mapping');
        return row as unknown as Mapping;
    });
    return { mappings, version: value.version };
}
function catalog(value: unknown): { tags: string[]; complete: boolean } {
    if (!isRecord(value) || !Array.isArray(value.tags) || value.tags.length > 10000 || !value.tags.every(text) || !isRecord(value.coverage) || typeof value.coverage.complete !== 'boolean') throw new Error('Invalid tag catalog');
    return { tags: value.tags, complete: value.coverage.complete };
}
export function OrderTagSettings() {
    const { token, user } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    if (!token || !currentAccount) return <p>Select an account and sign in.</p>;
    if (!hasPermission('manage_order_tag_mappings')) return <p>Tag mapping management permission required.</p>;
    return <ScopedSettings key={JSON.stringify([user?.id, token, currentAccount.id])} accountId={currentAccount.id} token={token} />;
}
function ScopedSettings({ accountId, token }: { accountId: string; token: string }) {
    const read = useScopedRequest(`/api/accounts/${encodeURIComponent(accountId)}/tag-mappings`, accountId, token, snapshot);
    const tags = useScopedRequest(`/api/accounts/${encodeURIComponent(accountId)}/product-tags`, accountId, token, catalog);
    return <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-slate-900 dark:text-slate-100 space-y-4"><h2 className="text-lg font-semibold">Order Tag Mappings</h2><p>One product tag can produce multiple order tags. Saving changes configuration only; it does not run order sync or remove manual tags.</p>
        {tags.loading ? <p role="status">Loading catalog tag suggestions…</p> : tags.error ? <p role="alert">Catalog suggestions unavailable. Existing mappings are retained. <button type="button" onClick={tags.retry}>Retry catalog</button></p> : !tags.data?.complete && <p role="status">Catalog suggestions are partial (first 5,000 products). Existing and manually entered product tags remain valid.</p>}
        {read.loading ? <p role="status">Loading mappings…</p> : read.error || !read.data ? <p role="alert">Mappings unavailable. <button type="button" onClick={read.retry}>Retry mappings</button></p> : <MappingEditor key={read.data.version} initial={read.data} token={token} accountId={accountId} suggestions={tags.data?.tags || []} onSaved={read.retry} />}
    </section>;
}
function MappingEditor({ initial, token, accountId, suggestions, onSaved }: { initial: { mappings: Mapping[]; version: string }; token: string; accountId: string; suggestions: string[]; onSaved: () => void }) {
    const [rows, setRows] = useState(() => initial.mappings.map(row => ({ ...row, rowId: crypto.randomUUID(), tagDraft: row.productTags.join('\n') })));
    const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false);
    const attempt = useRecoveryAttempt(); const { hasPermission } = usePermissions();
    useEffect(() => { if (!dirty) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [dirty]);
    const change = (rowId: string, data: Partial<typeof rows[number]>) => { setDirty(true); setRows(current => current.map(row => row.rowId === rowId ? { ...row, ...data } : row)); };
    async function save() {
        if (blocked || !hasPermission('manage_order_tag_mappings')) return;
        const mappings = rows.map(({ tagDraft, orderTag, enabled, color }) => ({ productTags: tagDraft.split(/\r?\n/).map(value => value.trim()).filter(Boolean), orderTag: orderTag.trim(), enabled, color }));
        if (mappings.some(row => !text(row.orderTag) || !row.productTags.length || row.productTags.length > 100 || !row.productTags.every(text))) { setError('Each mapping needs a bounded order tag and at least one product tag. Put each product tag on its own line.'); return; }
        const active = attempt.begin(); if (!active) return; setBusy(true); setError(''); const timer = setTimeout(() => active.abort(), 30000);
        try {
            const response = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/tag-mappings`, { method: 'PUT', signal: active.signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' }, body: JSON.stringify({ mappings, version: initial.version }) });
            const result = await response.json(); if (!response.ok || !isRecord(result) || result.success !== true) throw new Error('Unacknowledged'); snapshot(result);
            if (attempt.current(active)) { setDirty(false); onSaved(); }
        } catch { if (attempt.current(active, true)) { setError('Save unacknowledged or configuration changed. Local edits remain; reload and reconcile before further writes.'); setBlocked(true); } }
        finally { clearTimeout(timer); attempt.finish(); if (attempt.current(active, true)) setBusy(false); }
    }
    return <div className="space-y-3">{error && <p role="alert">{error}</p>}{blocked && <button type="button" onClick={() => { if (window.confirm('Discard local edits and reload mappings?')) onSaved(); }}>Discard edits and reload mappings</button>}
        <fieldset disabled={busy || blocked || !hasPermission('manage_order_tag_mappings')} className="space-y-3"><legend className="sr-only">Mapping rules</legend>{rows.map(row => <div className="grid gap-3 rounded border p-3 sm:grid-cols-2" key={row.rowId}>
            <label>Product tags (one per line)<textarea className="block w-full rounded border bg-white dark:bg-slate-950 p-2" value={row.tagDraft} maxLength={10100} onChange={event => change(row.rowId, { tagDraft: event.target.value })} /></label>
            <label>Order tag name<input className="block w-full rounded border bg-white dark:bg-slate-950 p-2" value={row.orderTag} maxLength={100} onChange={event => change(row.rowId, { orderTag: event.target.value })} /></label>
            <label><input type="checkbox" checked={row.enabled} onChange={event => change(row.rowId, { enabled: event.target.checked })} /> Active mapping</label>
            <label>Tag color<input type="color" value={row.color || '#6B7280'} onChange={event => change(row.rowId, { color: event.target.value })} /></label>
            <button type="button" onClick={() => { if (window.confirm('Remove this mapping from the local draft?')) { setRows(current => current.filter(value => value.rowId !== row.rowId)); setDirty(true); } }}>Remove mapping</button>
        </div>)}<button type="button" disabled={rows.length >= 500} onClick={() => { setRows(current => [...current, { rowId: crypto.randomUUID(), tagDraft: '', productTags: [], orderTag: '', enabled: true, color: '#6B7280' }]); setDirty(true); }}>Add mapping</button>
        <button type="button" onClick={() => void save()} disabled={!dirty}>{busy ? 'Saving…' : 'Save Mappings'}</button></fieldset>
        <details><summary>Catalog suggestions ({suggestions.length})</summary><p className="break-words">{suggestions.slice(0, 100).join(', ') || 'No suggestions in this sample.'}{suggestions.length > 100 && ' · Showing first 100 suggestions.'}</p></details>
    </div>;
}
