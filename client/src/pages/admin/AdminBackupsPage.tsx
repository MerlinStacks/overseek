import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { isRecord } from '../../utils/responseValidation';
import { abortable } from '../../utils/abortable';
import { formatDateTimeSafe } from '../../utils/format';
import { Modal } from '../../components/ui/Modal';
import { workspaceStyles as ui } from '../../components/ui/workspaceStyles';

interface Account { id: string; name: string; domain?: string | null }
interface Preview { accountId: string; accountName: string; recordCounts: Record<string, number>; estimatedSizeKB: number }
interface Settings { isEnabled: boolean; frequency: string; maxBackups: number; nextBackupAt: string | null; lastBackupAt: string | null }
interface Backup { id: string; accountId: string; filename: string; sizeBytes: number; recordCount: number; status: string; type: string; createdAt: string }
const frequencies = ['DAILY', 'EVERY_3_DAYS', 'WEEKLY'];
const card = 'p-6 space-y-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800';
const control = ui.input;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function decodeAccounts(value: unknown): Account[] {
    if (!Array.isArray(value) || !value.every(row => isRecord(row) && typeof row.id === 'string' && !!row.id && typeof row.name === 'string' && (row.domain == null || typeof row.domain === 'string'))) throw new Error('Invalid accounts');
    return value;
}
function decodePreview(value: unknown): Preview {
    if (!isRecord(value) || typeof value.accountId !== 'string' || typeof value.accountName !== 'string' || !isRecord(value.recordCounts) || !Object.values(value.recordCounts).every(count) || typeof value.estimatedSizeKB !== 'number' || !Number.isFinite(value.estimatedSizeKB) || value.estimatedSizeKB < 0) throw new Error('Invalid preview');
    return value as unknown as Preview;
}
function decodeSettings(value: unknown): Settings {
    if (!isRecord(value) || typeof value.isEnabled !== 'boolean' || !frequencies.includes(String(value.frequency)) || !count(value.maxBackups) || value.maxBackups < 1 || value.maxBackups > 2147483647 || !['lastBackupAt', 'nextBackupAt'].every(key => value[key] === null || typeof value[key] === 'string')) throw new Error('Invalid settings');
    return value as unknown as Settings;
}
function decodeBackups(value: unknown): Backup[] {
    if (!Array.isArray(value) || !value.every(row => isRecord(row) && ['id', 'accountId', 'filename', 'status', 'type', 'createdAt'].every(key => typeof row[key] === 'string') && count(row.sizeBytes) && count(row.recordCount))) throw new Error('Invalid backups');
    return value;
}
function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = Array.from(filename.replace(/[\\/]/g, '_'), char => char.charCodeAt(0) < 32 ? '_' : char).join('');
    try { document.body.appendChild(anchor); anchor.click(); }
    finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export function AdminBackupsPage() {
    const { token, user } = useAuth();
    if (!token || !user?.isSuperAdmin) return <p role="status">Sign in as a super admin to manage backups.</p>;
    return <BackupAccounts key={JSON.stringify([user.id, token])} token={token} />;
}
function BackupAccounts({ token }: { token: string }) {
    const accounts = useScopedRequest('/api/admin/accounts', '', token, decodeAccounts);
    const [accountId, setAccountId] = useState('');
    if (accounts.loading) return <p role="status">Loading accounts...</p>;
    if (accounts.error || !accounts.data) return <p role="alert">Could not load accounts. <button type="button" onClick={accounts.retry}>Retry accounts</button></p>;
    const selected = accounts.data.find(account => account.id === accountId);
    return <main className="space-y-6 text-slate-900 dark:text-slate-100">
        <h1 className="text-2xl font-bold">Account Backups</h1><p>Manage backups with auto-scheduling and restore.</p>
        <label className="block">Select Account<select className={`${control} block mt-2 w-full max-w-md`} value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">Choose an account...</option>{accounts.data.map(account => <option key={account.id} value={account.id}>{account.name}{account.domain ? ` (${account.domain})` : ''}</option>)}</select></label>
        {!accounts.data.length && <p>No accounts available.</p>}
        {selected && <AccountBackups key={accountId} token={token} account={selected} />}
    </main>;
}
function AccountBackups({ token, account }: { token: string; account: Account }) {
    const base = `/api/admin/accounts/${encodeURIComponent(account.id)}`;
    const preview = useScopedRequest(`${base}/backup/preview`, account.id, token, decodePreview);
    const settings = useScopedRequest(`${base}/backup/settings`, account.id, token, decodeSettings);
    const backups = useScopedRequest(`${base}/backups`, account.id, token, decodeBackups);
    const mutation = useScopedMutation();
    const [includeAuditLogs, setIncludeAuditLogs] = useState(false); const [includeAnalytics, setIncludeAnalytics] = useState(false);
    const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null); const [confirmName, setConfirmName] = useState('');
    const [message, setMessage] = useState('');
    const [failedRead, setFailedRead] = useState<{ preview: unknown; settings: unknown; backups: unknown } | null>(null);
    const blocked = failedRead && (failedRead.preview === preview.data || failedRead.settings === settings.data || failedRead.backups === backups.data);
    const loading = preview.loading || settings.loading || backups.loading;
    const readError = preview.error || settings.error || backups.error || preview.data?.accountId !== account.id || (backups.data && !backups.data.every(backup => backup.accountId === account.id));
    const ready = !loading && !readError && !!preview.data && !!settings.data && !!backups.data && !blocked;
    const refresh = () => { if (mutation.isPending()) return; preview.retry(); settings.retry(); backups.retry(); };
    const request = async (url: string, signal: AbortSignal, method = 'GET', body?: unknown) => {
        const response = await abortable(fetch(url, { method, signal, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), signal);
        if (!response.ok) throw new Error('Backup request failed');
        return response;
    };
    const action = async (kind: 'save' | 'download' | 'stored' | 'delete' | 'settings' | 'restore', backup?: Backup, updates?: Partial<Settings>) => {
        if (!ready || mutation.isPending() || !mutation.isActive()) return;
        if (backup && !backups.data?.some(item => item.id === backup.id && item.accountId === account.id)) return;
        if (kind === 'restore' && (!backup || backup.status !== 'COMPLETED' || confirmName !== preview.data!.accountName)) return;
        if (kind === 'delete' && !confirm(`Delete backup “${backup!.filename}” from ${account.name}?`)) return;
        setMessage('');
        const result = await mutation.run(async signal => {
            const backupPath = backup ? `/api/admin/backups/${encodeURIComponent(backup.id)}` : '';
            if (kind === 'download' || kind === 'stored') {
                const response = await request(kind === 'stored' ? `${backupPath}/download` : `${base}/backup`, signal, kind === 'stored' ? 'GET' : 'POST', kind === 'stored' ? undefined : { includeAuditLogs, includeAnalytics });
                const type = response.headers.get('Content-Type') ?? '';
                if (!/application\/(?:json|gzip|octet-stream)/i.test(type)) throw new Error('Invalid download');
                const blob = await abortable(response.blob(), signal); signal.throwIfAborted();
                if (!blob.size) throw new Error('Empty backup');
                const filename = backup?.filename || response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `backup_${account.id}.json`;
                downloadBlob(blob, filename); return 'Backup download started.';
            }
            const path = kind === 'save' ? `${base}/backup/save` : kind === 'settings' ? `${base}/backup/settings` : kind === 'restore' ? `${backupPath}/restore` : backupPath;
            const body = kind === 'save' ? { includeAuditLogs, includeAnalytics } : kind === 'settings' ? updates : kind === 'restore' ? { confirmAccountName: confirmName, accountId: account.id } : undefined;
            const response = await request(path, signal, kind === 'delete' ? 'DELETE' : kind === 'settings' ? 'PUT' : 'POST', body);
            const data: unknown = await abortable(response.json(), signal);
            if (kind === 'settings') decodeSettings(data);
            else if (kind === 'save') { const saved = decodeBackups([data])[0]; if (saved.accountId !== account.id) throw new Error('Mismatched backup'); }
            else if (!isRecord(data) || data.success !== true || (kind === 'restore' && (!Array.isArray(data.restoredTables) || !data.restoredTables.every(item => typeof item === 'string')))) throw new Error('Invalid action confirmation');
            return kind === 'restore' ? `Restored: ${(data as { restoredTables: string[] }).restoredTables.join(', ') || 'no restorable tables'}.` : 'Backup change confirmed.';
        }, 'Could not confirm the backup operation. It may have completed. Refresh all account data and check status before retrying.');
        if (result.ok) { setMessage(result.value); setRestoreTarget(null); setConfirmName(''); refresh(); }
        else if (mutation.isActive()) {
            setRestoreTarget(null); setConfirmName('');
            setFailedRead({ preview: preview.data, settings: settings.data, backups: backups.data });
        }
    };
    return <section className="space-y-4" aria-label={`Backups for ${account.name}`}>
        <button className={ui.secondary} type="button" disabled={mutation.busy} onClick={refresh}>Refresh account backup data</button>
        {loading && <p role="status">Loading account backup data...</p>}
        {readError && !loading && <p role="alert">Could not load valid backup preview, schedule or stored backups. Refresh to retry.</p>}
        {mutation.error && <p role="alert">{mutation.error}</p>}{message && <p role="status">{message}</p>}{mutation.busy && <p role="status">Processing backup operation...</p>}
        {ready && <fieldset disabled={mutation.busy} className="space-y-6">
            <section className={card}><h2 className="font-semibold">Auto-Backup Schedule</h2>
                <label className="flex gap-2"><input type="checkbox" checked={settings.data!.isEnabled} onChange={event => void action('settings', undefined, { isEnabled: event.target.checked })} />Enabled</label>
                <div className="flex flex-wrap gap-4"><label>Frequency<select className={`${control} block`} value={settings.data!.frequency} onChange={event => { if (frequencies.includes(event.target.value)) void action('settings', undefined, { frequency: event.target.value }); }}>{frequencies.map(value => <option key={value}>{value}</option>)}</select></label>
                    <label>Keep Last<select className={`${control} block`} value={settings.data!.maxBackups} onChange={event => { const value = Number(event.target.value); if (Number.isSafeInteger(value) && value >= 1 && value <= 2147483647) void action('settings', undefined, { maxBackups: value }); }}>{Array.from(new Set([1, 2, 3, 4, 5, 7, 10, settings.data!.maxBackups])).sort((a, b) => a - b).map(value => <option key={value} value={value}>{value} backups</option>)}</select></label>
                    <p>Next Backup: {settings.data!.nextBackupAt ? formatDateTimeSafe(settings.data!.nextBackupAt, 'Date unavailable') : settings.data!.isEnabled ? 'Unavailable' : 'Disabled'}</p></div>
            </section>
            <section className={card}><h2 className="font-semibold">Stored Backups ({backups.data!.length})</h2>
                {!backups.data!.length ? <p className={ui.empty}>No stored backups.</p> : <div className="overflow-x-auto"><table className={ui.table}><caption className="sr-only">Stored backups for {account.name}</caption><thead className={ui.tableHead}><tr>{['Date', 'Type / Status', 'Size', 'Records', 'Actions'].map(label => <th scope="col" className={`${ui.cell} font-medium`} key={label}>{label}</th>)}</tr></thead><tbody className={ui.tableBody}>{backups.data!.map(backup => <tr key={backup.id}>
                    <td className={`${ui.cell} whitespace-nowrap text-xs`}>{formatDateTimeSafe(backup.createdAt, 'Date unavailable')}</td><td className={ui.cell}><span className={ui.badge}>{backup.type} · {backup.status}</span></td><td className={`${ui.cell} whitespace-nowrap tabular-nums`}>{(backup.sizeBytes / 1024).toFixed(0)} KB</td><td className={`${ui.cell} tabular-nums`}>{backup.recordCount.toLocaleString()}</td><td className={ui.cell}><div className="flex flex-wrap gap-2"><button className={ui.secondary} type="button" onClick={() => void action('stored', backup)}>Download {backup.filename}</button><button className={ui.danger} type="button" disabled={backup.status !== 'COMPLETED'} onClick={() => { setRestoreTarget(backup); setConfirmName(''); }}>Restore {backup.filename}</button><button className={ui.danger} type="button" disabled={backup.status === 'RESTORING'} onClick={() => void action('delete', backup)}>Delete {backup.filename}</button></div></td>
                </tr>)}</tbody></table></div>}
            </section>
            <section className={card}><h2 className="font-semibold">New Backup Preview · {preview.data!.accountName}</h2><p className={ui.muted}>Estimated size: {preview.data!.estimatedSizeKB.toFixed(0)} KB</p><dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Object.entries(preview.data!.recordCounts).map(([table, total]) => <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50" key={table}><dt className={`break-all ${ui.muted}`}>{table}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{total.toLocaleString()}</dd></div>)}</dl>
                <label className="flex gap-2"><input type="checkbox" checked={includeAuditLogs} onChange={event => setIncludeAuditLogs(event.target.checked)} />Include audit logs</label><label className="flex gap-2"><input type="checkbox" checked={includeAnalytics} onChange={event => setIncludeAnalytics(event.target.checked)} />Include analytics</label>
                <div className="flex flex-wrap gap-3"><button className={ui.primary} type="button" onClick={() => void action('save')}>Save to Storage</button><button className={ui.secondary} type="button" onClick={() => void action('download')}>Download Now</button></div>
            </section>
        </fieldset>}
        <Modal isOpen={!!restoreTarget && !!preview.data && !blocked} onClose={mutation.busy ? undefined : () => setRestoreTarget(null)} title="Restore Backup">
            <p>This replaces existing data in <strong>{preview.data?.accountName}</strong> using <strong>{restoreTarget?.filename}</strong>.</p>
            <p>Type the account name to confirm.</p><label className="block my-4">Account name confirmation<input className={`${control} block w-full`} value={confirmName} disabled={mutation.busy} onChange={event => setConfirmName(event.target.value)} /></label>
            <button className={ui.danger} type="button" disabled={!ready || mutation.busy || !confirmName || confirmName !== preview.data?.accountName} onClick={() => { if (restoreTarget) void action('restore', restoreTarget); }}>Confirm Restore</button>
        </Modal>
    </section>;
}
