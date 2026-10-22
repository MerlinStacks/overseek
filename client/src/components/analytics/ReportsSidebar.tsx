import { useState } from 'react';
import { z } from 'zod';
import type { ReportTemplate } from '../../types/analytics';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedMutation } from '../../hooks/useScopedMutation';

interface Props {
    templates: ReportTemplate[];
    selectedTemplateId?: string;
    onSelect: (template: ReportTemplate) => void;
    onDelete: (event: React.MouseEvent, id: string) => void | Promise<void>;
    onCreateCustom: () => void;
}
const templateSchema = z.object({
    id: z.string().min(1).max(200), name: z.string().min(1).max(200),
    type: z.enum(['SYSTEM', 'SYSTEM_CLONE', 'CUSTOM']),
    updatedAt: z.string().datetime({ offset: true }).optional(),
    category: z.string().max(80).optional(),
    config: z.object({ dimension: z.string().min(1).max(80), dateRange: z.string().min(1).max(100), metrics: z.array(z.string().max(80)).max(30) }),
});
const categories = new Set(['Sales', 'Traffic', 'Customer', 'Conversion']);

export function ReportsSidebar(props: Props) {
    const { token, user } = useAuth(), { currentAccount } = useAccount();
    return <Library key={JSON.stringify([user?.id, token, currentAccount?.id])} {...props} />;
}
function Library({ templates, selectedTemplateId, onSelect, onDelete, onCreateCustom }: Props) {
    const [search, setSearch] = useState(''), [blocked, setBlocked] = useState(false);
    const mutation = useScopedMutation(), { hasPermission } = usePermissions();
    const canManage = hasPermission('*');
    const parsed = z.array(templateSchema).max(500).safeParse(templates);
    if (!parsed.success || new Set(parsed.data.map(row => row.id)).size !== parsed.data.length) return <p role="alert">Report library observations unavailable.</p>;
    const rows = parsed.data;
    const filtered = rows.filter(row => row.id === selectedTemplateId || row.name.toLowerCase().includes(search.trim().toLowerCase()));
    const groups = new Map<string, typeof rows>();
    for (const row of filtered) {
        const category = row.type === 'CUSTOM' ? 'My templates' : row.category && categories.has(row.category) ? row.category : 'Unknown category';
        groups.set(category, [...(groups.get(category) ?? []), row]);
    }
    const remove = async (event: React.MouseEvent, row: typeof rows[number]) => {
        if (!canManage || blocked || mutation.isPending() || !row.updatedAt || !window.confirm(`Delete custom report ${row.name}? Linked schedules or a changed version will block deletion.`)) return;
        const result = await mutation.run(async () => onDelete(event, row.id), 'Deletion unacknowledged. Reconcile the original operation before repeating.');
        if (!result.ok && mutation.isActive()) setBlocked(true);
    };
    return (
        <aside className="w-full space-y-4 rounded-2xl border bg-white/80 p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 lg:w-80">
            <h2 className="font-semibold">Report library</h2>
            <p className="text-sm">{rows.length} supplied template observations (window capped at 500); source coverage and report readiness are not established.</p>
            <label className="block">Search reports<input className="block w-full rounded border p-2 dark:bg-slate-800" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></label>
            {canManage && <button type="button" disabled={mutation.busy || blocked} onClick={onCreateCustom}>New custom report</button>}
            {mutation.error && <p role="alert">{mutation.error}</p>}
            {[...groups].map(([category, group]) => (
                <section key={category}>
                    <h3 className="text-sm font-semibold">{category}</h3>
                    {group.map(row => (
                        <div key={row.id} className="my-2 rounded border p-2">
                            <button type="button" aria-pressed={row.id === selectedTemplateId} disabled={mutation.busy} className="w-full rounded p-2 text-left aria-pressed:bg-indigo-100 dark:aria-pressed:bg-indigo-950" onClick={() => onSelect(structuredClone(row) as ReportTemplate)}>
                                <strong>{row.name}</strong><p className="text-xs">{row.config.dimension} · {row.config.dateRange}</p>
                            </button>
                            {row.type === 'CUSTOM' && canManage && <button type="button" disabled={mutation.busy || blocked || !row.updatedAt} aria-label={`Delete report ${row.name}`} onClick={event => void remove(event, row)}>Delete</button>}
                        </div>
                    ))}
                </section>
            ))}
            {!filtered.length && <p>No matching supplied templates.</p>}
        </aside>
    );
}
