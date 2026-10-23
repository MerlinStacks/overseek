import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { usePermissions } from '../hooks/usePermissions';
import { useScopedRequest } from '../hooks/useScopedRequest';
import { useRecoveryAttempt } from '../hooks/useRecoveryAttempt';
import { isRecord } from '../utils/responseValidation';
import { FileText } from 'lucide-react';
import { workspaceStyles as ui } from '../components/ui/workspaceStyles';

interface Policy { id: string; title: string; content: string; type: 'POLICY' | 'SOP' | 'TRAINING'; category: string | null; isPublished: boolean; updatedAt: string }
interface Prompt { id: string; name: string | null; content: string; version: string; isAccountOverride: boolean }
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
function policy(value: unknown): Policy {
    if (!isRecord(value) || !text(value.id, 200) || !text(value.title, 200) || !text(value.content, 100000) || !['POLICY', 'SOP', 'TRAINING'].includes(String(value.type)) || typeof value.isPublished !== 'boolean' || value.category !== null && !text(value.category, 100) || !text(value.updatedAt, 40) || !Number.isFinite(Date.parse(String(value.updatedAt)))) throw new Error('Invalid policy');
    return value as unknown as Policy;
}
function policies(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 100 || value.nextCursor !== null && !text(value.nextCursor, 200)) throw new Error('Invalid policy page');
    return { items: value.items.map(policy), nextCursor: value.nextCursor as string | null };
}
function prompts(value: unknown): Prompt[] {
    if (!Array.isArray(value) || value.length > 5 || value.some(row => !isRecord(row) || !text(row.id, 100) || !text(row.content, 30000) || row.name !== null && !text(row.name, 200) || !text(row.version, 200) || typeof row.isAccountOverride !== 'boolean')) throw new Error('Invalid prompts');
    return value;
}
type Selection = { kind: 'new' } | { kind: 'policy'; value: Policy } | { kind: 'prompt'; value: Prompt };
const box = ui.card;
const input = ui.input;
export function PoliciesPage() {
    const { user, token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Sign in and select an account.</p>;
    return <ScopedPolicies key={JSON.stringify([user?.id, token, currentAccount.id])} token={token} accountId={currentAccount.id} />;
}
function ScopedPolicies({ token, accountId }: { token: string; accountId: string }) {
    const { hasPermission } = usePermissions();
    const canView = hasPermission('view_policies'), canManage = hasPermission('manage_policies'), canPrompt = hasPermission('manage_ai_prompts');
    const [cursor, setCursor] = useState<string | null>(null), [selection, setSelection] = useState<Selection | null>(null), [dirty, setDirty] = useState(false);
    const list = useScopedRequest(canView ? `/api/policies${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}` : null, accountId, token, policies);
    const templates = useScopedRequest(canPrompt ? '/api/policies/ai-prompts' : null, accountId, token, prompts);
    const choose = (value: Selection | null) => { if (dirty && !window.confirm('Discard unsaved local changes?')) return false; setDirty(false); setSelection(value); return true; };
    const reload = () => { setSelection(null); setDirty(false); list.retry(); templates.retry(); };
    useEffect(() => { if (!dirty) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [dirty]);
    return <main className="space-y-4 text-slate-900 dark:text-slate-100">
        <h1 className="flex items-center gap-3 text-2xl font-bold"><FileText size={24} className="text-indigo-500" />Policies &amp; SOPs</h1>
        <p className={ui.muted}>Plain-text documents and account AI prompt overrides. Saving requires a current server version.</p>
        <div className="grid gap-4 lg:grid-cols-[minmax(16rem,1fr)_minmax(0,2fr)]">
            <aside className={`${box} space-y-3`} aria-label="Documents and prompts">
                {canManage && <button className={`${ui.primary} w-full`} type="button" onClick={() => choose({ kind: 'new' })}>Create policy</button>}
                {!canView ? <p>Policy view permission required.</p> : list.loading ? <p role="status">Loading policies…</p> : list.error ? <p role="alert">Policies unavailable. <button type="button" onClick={list.retry}>Retry policies</button></p> : <>
                    {list.data?.items.length === 0 && <p>No policies in this page.</p>}
                    {list.data?.items.map(item => <button type="button" aria-pressed={selection?.kind === 'policy' && selection.value.id === item.id} className={`block w-full rounded-lg border px-3 py-3 text-left text-sm transition-colors ${selection?.kind === 'policy' && selection.value.id === item.id ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-700/50'}`} key={item.id} onClick={() => choose({ kind: 'policy', value: item })}><span className="block break-words font-medium">{item.title} {!item.isPublished && '(draft)'}</span><span className={`mt-1 block text-[10px] ${ui.muted}`}>{item.type}{item.category ? ` · ${item.category}` : ''}</span></button>)}
                    {cursor && <button className={ui.secondary} type="button" onClick={() => { if (choose(null)) setCursor(null); }}>First policy page</button>}
                    {list.data?.nextCursor && <button className={ui.secondary} type="button" onClick={() => { if (dirty && !window.confirm('Discard unsaved local changes?')) return; setSelection(null); setDirty(false); setCursor(list.data!.nextCursor); }}>Next policy page</button>}
                </>}
                {canPrompt && <section className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-700"><h2 className={ui.title}>AI prompts</h2>{templates.loading ? <p role="status">Loading prompts…</p> : templates.error ? <p role="alert">Prompts unavailable. <button className={ui.secondary} type="button" onClick={templates.retry}>Retry prompts</button></p> : templates.data?.map(item => <button type="button" key={item.id} className="block w-full rounded-lg p-3 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-700/50" onClick={() => choose({ kind: 'prompt', value: item })}>{item.name || item.id} ({item.isAccountOverride ? 'account override' : 'default'})</button>)}</section>}
            </aside>
            <section className={box}>{selection ? <Editor key={selection.kind === 'new' ? 'new' : `${selection.kind}:${selection.value.id}:${selection.kind === 'policy' ? selection.value.updatedAt : selection.value.version}`} selection={selection} token={token} accountId={accountId} editable={selection.kind === 'prompt' ? canPrompt : canManage} onDirty={setDirty} onSaved={reload} /> : <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-slate-400"><FileText size={32} /><p className="text-sm">Select a document or prompt.</p></div>}</section>
        </div>
    </main>;
}
function Editor({ selection, token, accountId, editable, onDirty, onSaved }: { selection: Selection; token: string; accountId: string; editable: boolean; onDirty: (value: boolean) => void; onSaved: () => void }) {
    const existing = selection.kind === 'policy' ? selection.value : null, template = selection.kind === 'prompt' ? selection.value : null;
    const [createId] = useState(() => crypto.randomUUID());
    const [title, setTitle] = useState(existing?.title || ''), [content, setContent] = useState(existing?.content ?? template?.content ?? '');
    const [type, setType] = useState(existing?.type || 'POLICY'), [category, setCategory] = useState(existing?.category || ''), [published, setPublished] = useState(existing?.isPublished ?? false);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false);
    const attempt = useRecoveryAttempt();
    async function write(remove = false) {
        if (!editable || blocked || (!remove && (!content.trim() || !template && !title.trim()))) return;
        if (remove && !window.confirm(template ? 'Remove this account override and use the current global default?' : 'Delete this policy?')) return;
        const current = attempt.begin(); if (!current) return;
        setBusy(true); setError(''); const timer = setTimeout(() => current.abort(), 30000);
        const url = template ? `/api/policies/ai-prompts/${encodeURIComponent(template.id)}` : existing ? `/api/policies/${encodeURIComponent(existing.id)}` : '/api/policies';
        const body = template ? { version: template.version, ...(!remove ? { content, name: template.name } : {}) } : remove ? { version: existing!.updatedAt } : { title: title.trim(), content, type, category: category.trim() || null, isPublished: published, ...(existing ? { version: existing.updatedAt } : { id: createId }) };
        try {
            const res = await fetch(url, { method: remove ? 'DELETE' : template || existing ? 'PUT' : 'POST', signal: current.signal, headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const result = await res.json(); if (!res.ok) throw new Error('Write failed');
            if (template || remove) { if (!isRecord(result) || result.success !== true) throw new Error('Invalid acknowledgement'); } else policy(result);
            if (attempt.current(current)) onSaved();
        } catch { if (attempt.current(current, true)) { setError('Write was not acknowledged or the document changed. Local edits remain; reload before any further writes.'); setBlocked(true); } }
        finally { clearTimeout(timer); attempt.finish(); if (attempt.current(current, true)) setBusy(false); }
    }
    const disabled = !editable || busy || blocked;
    return <div className="space-y-4"><h2 className="text-xl font-semibold">{template ? template.name || template.id : existing ? 'Policy details' : 'New policy'}</h2>
        {!template && <><label className="block">Title<input className={input} value={title} maxLength={200} disabled={disabled} onChange={e => { setTitle(e.target.value); onDirty(true); }} /></label>
            <label className="block">Document type<select className={input} disabled={disabled} value={type} onChange={e => { setType(e.target.value as Policy['type']); onDirty(true); }}>{['POLICY', 'SOP', 'TRAINING'].map(value => <option key={value}>{value}</option>)}</select></label>
            <label className="block">Category<input className={input} value={category} maxLength={100} disabled={disabled} onChange={e => { setCategory(e.target.value); onDirty(true); }} /></label>
            <label><input type="checkbox" checked={published} disabled={disabled} onChange={e => { setPublished(e.target.checked); onDirty(true); }} /> Published for AI/reference readers</label></>}
        <label className="block">{template ? 'Prompt content' : 'Document content (plain text)'}<textarea className={`${input} min-h-72`} value={content} maxLength={template ? 30000 : 100000} disabled={disabled} onChange={e => { setContent(e.target.value); onDirty(true); }} /></label>
        {error && <p role="alert">{error} <button type="button" onClick={() => { if (window.confirm('Discard local edits and reload?')) onSaved(); }}>Discard edits and reload</button></p>}
        {busy && <p role="status">Saving…</p>}
        {editable && <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-700"><button className={ui.primary} type="button" disabled={disabled} onClick={() => void write()}>Save</button>{(existing || template?.isAccountOverride) && <button className={ui.danger} type="button" disabled={disabled} onClick={() => void write(true)}>{template ? 'Reset to global default' : 'Delete policy'}</button>}</div>}
    </div>;
}
