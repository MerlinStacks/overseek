import { useEffect, useRef, useState } from 'react';
import type { EmailSection } from '../../../lib/emailDesignerV2';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
interface Preset { id: string; name: string; version: number; section: EmailSection }
export function SharedSections({ section, onInsert, onLink, onRefresh }: { section?: EmailSection; onInsert: (value: EmailSection) => void; onLink: (value: NonNullable<EmailSection['preset']>) => void; onRefresh: (value: EmailSection) => void }) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    const [presets, setPresets] = useState<Preset[]>([]); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false); const [reload, setReload] = useState(0); const [hasMore, setHasMore] = useState(false);
    const headers = { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount?.id || '', 'Content-Type': 'application/json' };
    const scope = JSON.stringify([currentAccount?.id, token, section]);
    const activeScope = useRef(scope); activeScope.current = scope;
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        const controller = new AbortController(); setPresets([]); setError('');
        if (token && currentAccount) void fetch('/api/marketing/designer/sections', { signal: controller.signal, headers }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Brand library unavailable'); if (!controller.signal.aborted) { setPresets(Array.isArray(data.presets) ? data.presets : []); setHasMore(data.hasMore === true); } }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
        return () => controller.abort();
    }, [currentAccount?.id, token, reload]);
    const save = async (update: boolean) => {
        if (!section || busy) return;
        const requestScope = scope;
        const name = update ? section.preset?.name : window.prompt('Brand section name', section.name || 'Reusable section')?.trim();
        if (!name || update && !window.confirm('Update the library source? Existing emails keep their snapshots until someone explicitly refreshes them.')) return;
        setBusy(true); setError(''); setNotice('');
        try {
            const response = await fetch(`/api/marketing/designer/sections${update ? `/${section.preset!.id}` : ''}`, { method: update ? 'PUT' : 'POST', headers, body: JSON.stringify({ name, section, ...(update ? { version: section.preset!.version } : {}) }) });
            const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Library save failed');
            if (!mounted.current || activeScope.current !== requestScope) return;
            onLink({ id: data.id, version: data.version, name: data.name }); setReload(value => value + 1); setNotice(update ? 'Library source updated. Existing emails were not changed.' : 'Saved to this account’s brand library.');
        } catch (err) { if (mounted.current && activeScope.current === requestScope) setError((err as Error).message); } finally { if (mounted.current) setBusy(false); }
    };
    const linked = presets.find(preset => preset.id === section?.preset?.id);
    return <section aria-label="Shared brand sections" className="space-y-2 rounded-lg border border-indigo-200 p-3 dark:border-indigo-900">
        <p className="text-sm font-semibold">Brand section library</p><p className="text-xs text-slate-500">Inserted sections are snapshots. Editing this instance never silently changes other emails.</p>
        {section && <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void save(false)} className="rounded border px-2 py-1 text-xs">Save new library copy</button>{section.preset && <><button disabled={busy} onClick={() => void save(true)} className="rounded border px-2 py-1 text-xs">Update library source v{section.preset.version}</button><button disabled={busy || !linked || linked.version === section.preset.version} onClick={() => { if (linked && window.confirm('Replace this instance with the latest library snapshot? You can undo this change.')) onRefresh({ ...linked.section, preset: { id: linked.id, version: linked.version, name: linked.name } }); }} className="rounded border px-2 py-1 text-xs disabled:opacity-40">Refresh this instance</button></>}</div>}
        <button onClick={() => setReload(value => value + 1)} className="text-xs text-indigo-600 underline">Refresh library</button>
        <div className="max-h-52 space-y-1 overflow-auto">{presets.map(preset => <button key={preset.id} onClick={() => onInsert({ ...preset.section, preset: { id: preset.id, version: preset.version, name: preset.name } })} className="block w-full rounded border px-2 py-2 text-left text-xs">Insert {preset.name} · v{preset.version}</button>)}</div>
        {hasMore && <p className="text-xs text-amber-700">Showing the 100 most recently updated sections.</p>}{error && <p role="alert" className="text-xs text-red-700">{error}</p>}{notice && <p role="status" className="text-xs text-green-700">{notice}</p>}
    </section>;
}
