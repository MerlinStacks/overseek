import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { useScopedMutation } from '../../../hooks/useScopedMutation';
import { readBoundedBytes } from '../../../utils/boundedResponse';
import { Modal } from '../../ui/Modal';

export interface EmailTemplate { id: string; name: string; subject: string | null; content: string; designJson: unknown; createdAt: string; updatedAt: string }
interface Props { onSelect: (template: EmailTemplate) => void | boolean | Promise<void | boolean>; onClose: () => void }
const rowSchema = z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200), subject: z.string().max(1000).nullable(), content: z.string().max(1000000), designJson: z.unknown(), createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }) });
export function EmailTemplateSelectorModal(props: Props) {
    const { token, user } = useAuth(), { currentAccount } = useAccount(), { hasPermission } = usePermissions();
    if (!token || !user?.id || !currentAccount || !hasPermission('manage_marketing')) return <Modal isOpen onClose={props.onClose} title="Email templates"><p role="alert">Select an account with marketing management access.</p></Modal>;
    return <TemplateScope key={JSON.stringify([user.id, token, currentAccount.id])} {...props} token={token} accountId={currentAccount.id} />;
}
function TemplateScope({ token, accountId, onSelect, onClose }: Props & { token: string; accountId: string }) {
    const [rows, setRows] = useState<EmailTemplate[] | null>(null), [error, setError] = useState(false), [attempt, setAttempt] = useState(0), [search, setSearch] = useState('');
    const mutation = useScopedMutation();
    useEffect(() => {
        let active = true; const controller = new AbortController();
        void (async () => {
            try {
                const response = await fetch('/api/marketing/templates', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId } });
                if (!response.ok) throw new Error('Unavailable');
                const data = z.array(rowSchema).max(200).parse(JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 4 * 1024 * 1024))));
                if (new Set(data.map(row => row.id)).size !== data.length) throw new Error('Duplicate template identity');
                if (active) setRows(data as EmailTemplate[]);
            } catch { if (active) setError(true); }
        })();
        return () => { active = false; controller.abort(); };
    }, [token, accountId, attempt]);
    const choose = async (row: EmailTemplate) => {
        if (mutation.isPending() || !window.confirm('Replace the current local email draft with this observed template version? This does not save, activate or send. The editor must validate design compatibility before accepting it.')) return;
        const result = await mutation.run(async () => {
            const accepted = await onSelect(structuredClone(row));
            if (accepted === false) throw new Error('Draft replacement declined');
        }, 'Draft replacement was not acknowledged; review the editor before repeating.');
        if (result.ok && mutation.isActive()) onClose();
    };
    return <Modal isOpen onClose={mutation.busy ? undefined : onClose} title="Import an email template draft"><div className="space-y-4 text-slate-900 dark:text-slate-100"><p>Bounded local template observations, at most 200 rows. No remote images are loaded. Content and design compatibility are validated by the receiving editor, not inferred from a template name.</p><label className="block">Search templates<input className="block w-full rounded border p-2 dark:bg-slate-800" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} /></label>{mutation.error && <p role="alert">{mutation.error}</p>}{error ? <p role="alert">Templates unavailable. <button type="button" onClick={() => { setRows(null); setError(false); setAttempt(value => value + 1); }}>Retry read</button></p> : !rows ? <p role="status">Loading templates…</p> : <div className="grid gap-3 sm:grid-cols-2">{rows.filter(row => `${row.name} ${row.subject ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())).map(row => <button type="button" key={row.id} disabled={mutation.busy} onClick={() => void choose(row)} className="rounded border p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800"><strong>{row.name}</strong><p>{row.subject ?? 'Subject not recorded'}</p><p className="text-sm">Observed version {new Date(row.updatedAt).toLocaleString()}</p></button>)}{!rows.length && <p>No templates in this acknowledged response.</p>}</div>}<button type="button" disabled={mutation.busy} onClick={onClose}>Keep current draft / close</button></div></Modal>;
}
