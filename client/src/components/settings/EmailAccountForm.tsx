import { useState } from 'react';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { readBoundedBytes } from '../../utils/boundedResponse';
import { Mail, Send, Inbox, ShieldCheck, Globe } from 'lucide-react';
import { workspaceStyles as ui } from '../ui/workspaceStyles';
import { DataNote } from '../ui/DataNote';

export interface EmailAccount {
    id: string; accountId: string; name: string; email: string;
    smtpEnabled: boolean; smtpHost?: string; smtpPort?: number; smtpUsername?: string; smtpPassword?: string; smtpSecure?: boolean;
    imapEnabled: boolean; imapHost?: string; imapPort?: number; imapUsername?: string; imapPassword?: string; imapSecure?: boolean;
    relayEndpoint?: string; relayApiKey?: string; relayProfileId?: string; isDefault?: boolean; updatedAt?: string;
    operationId?: string; version?: string | null;
}
interface TestData { protocol: 'SMTP' | 'IMAP'; host: string; port: number; username: string; password: string; isSecure: boolean; id?: string; operationId: string; version: string | null }
interface Props { initialData: Partial<EmailAccount>; onSave: (data: Partial<EmailAccount>) => Promise<void>; onCancel: () => void; onTest: (data: TestData) => Promise<{ success: boolean; message?: string }>; isSaving: boolean; isTesting: boolean; testResult: { success: boolean; message?: string } | null }
const protocols = ['smtp', 'imap'] as const;
export function EmailAccountForm(props: Props) {
    const { token, user } = useAuth(), { currentAccount } = useAccount(), { hasPermission } = usePermissions();
    if (!token || !currentAccount || props.initialData.accountId && props.initialData.accountId !== currentAccount.id || !hasPermission('manage_email_settings')) return <p role="alert">Select the matching account with email settings management access.</p>;
    return <AccountDraft key={JSON.stringify([user?.id, token, currentAccount.id, props.initialData.id, props.initialData.updatedAt])} {...props} token={token} accountId={currentAccount.id} />;
}
function AccountDraft({ initialData, onSave, onCancel, onTest, isSaving, isTesting, token, accountId }: Props & { token: string; accountId: string }) {
    const [form, setForm] = useState<Partial<EmailAccount>>(() => ({ smtpEnabled: false, imapEnabled: false, smtpSecure: true, imapSecure: true, ...initialData, smtpPort: initialData.smtpPort ?? 587, imapPort: initialData.imapPort ?? 993, ...Object.fromEntries(['name', 'email', 'smtpHost', 'smtpUsername', 'imapHost', 'imapUsername', 'relayEndpoint', 'relayProfileId'].map(key => [key, typeof initialData[key as keyof EmailAccount] === 'string' ? initialData[key as keyof EmailAccount] : ''])), smtpPassword: '', imapPassword: '', relayApiKey: '' }));
    const [baseline] = useState(() => JSON.stringify(form)), [operationId, setOperationId] = useState(() => crypto.randomUUID()), [blocked, setBlocked] = useState(false), [message, setMessage] = useState('');
    const mutation = useScopedMutation(), { hasPermission } = usePermissions();
    const busy = isSaving || isTesting || mutation.busy || blocked, dirty = JSON.stringify(form) !== baseline;
    const update = (key: keyof EmailAccount, value: unknown) => setForm(previous => ({ ...previous, [key]: value }));
    const cancel = () => { if (!mutation.isPending() && (!dirty || window.confirm('Discard this local email account draft and replacement secrets? Unconfirmed server work is not rolled back.'))) onCancel(); };
    const act = async (action: 'save' | 'SMTP' | 'IMAP' | 'relay') => {
        if (busy || mutation.isPending()) return;
        if (action !== 'save' && !hasPermission('*')) { setMessage('Admin access and an operator-allowlisted destination are required for network tests.'); return; }
        try {
            z.string().trim().min(1).max(120).parse(form.name); z.string().email().max(254).parse(form.email);
            for (const protocol of protocols) if (form[`${protocol}Enabled`]) { z.number().int().min(1).max(65535).parse(form[`${protocol}Port`]); z.string().trim().min(1).max(253).parse(form[`${protocol}Host`]); if (!form[`${protocol}Secure`]) throw new Error('TLS required'); }
            if (form.smtpEnabled && form.relayEndpoint) throw new Error('Choose SMTP or relay');
            if (form.relayEndpoint) { const url = new URL(form.relayEndpoint); if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('HTTPS endpoint required'); }
        } catch { setMessage('Review name/email, integer ports 1–65535, explicit TLS and credential-free HTTPS relay. Choose SMTP or relay, not both.'); return; }
        if (!window.confirm(action === 'save' ? 'Save this reviewed email account version? Blank replacement secrets retain existing credentials. This does not test connectivity or send mail.' : `Run this deliberate ${action} network/authentication test? The operator must allowlist the destination. It is not delivery proof; do not retry an uncertain outcome.`)) return;
        const result = await mutation.run(async signal => {
            if (action === 'save') { await onSave({ ...form, operationId, version: initialData.updatedAt ?? null }); return 'Save acknowledged'; }
            const meta = { operationId, version: initialData.updatedAt ?? null };
            if (action === 'relay') {
                const response = await fetch('/api/email/test-relay', { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...meta, data: { relayEndpoint: form.relayEndpoint, relayApiKey: form.relayApiKey || (initialData.relayApiKey ? '••••••••' : undefined), relayProfileId: form.relayProfileId, emailAccountId: form.id } }) });
                if (!response.ok) throw new Error('Relay test unavailable');
                const data = z.object({ success: z.literal(true) }).parse(JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 64000))));
                return data.success ? 'Relay acceptance observed; delivery is not established' : '';
            }
            const protocol = action === 'SMTP' ? 'smtp' : 'imap';
            const data = await onTest({ ...meta, protocol: action, id: form.id, host: form[`${protocol}Host`] || '', port: form[`${protocol}Port`]!, username: form[`${protocol}Username`] || form.email || '', password: form[`${protocol}Password`] || (initialData[`${protocol}Password`] ? '••••••••' : ''), isSecure: form[`${protocol}Secure`] === true });
            if (data.success !== true) throw new Error('Connection not acknowledged');
            return 'Connection/authentication observed; sending and receiving coverage are not established';
        }, `Operation ${operationId} unconfirmed or rejected. Preserve the draft and reconcile before repeating; closing is not rollback.`);
        if (mutation.isActive()) { if (result.ok) { setMessage(String(result.value)); setOperationId(crypto.randomUUID()); } else setBlocked(true); }
    };
    return <section className={`${ui.card} space-y-5 text-slate-900 dark:text-slate-100`}>
        <header className="flex items-center gap-3"><span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"><Mail size={20} /></span><div><h2 className="text-lg font-semibold">{form.id ? 'Edit' : 'New'} email account</h2><p className={ui.muted}>Configure sending, receiving and relay connections.</p></div></header>
        <DataNote title="Credentials and connection tests">Fields are a local draft, not observed connection readiness. Blank replacement secrets retain saved values; masked server markers are never edited as passwords. Network tests require admin access and an operator-allowlisted destination.</DataNote>
        {message && <p role="status" className={ui.notice}>{message}</p>}{mutation.error && <p role="alert" className={ui.alert}>{mutation.error}</p>}
        <fieldset disabled={busy} className="min-w-0 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">{(['name', 'email'] as const).map(key => <label key={key} className={ui.label}><span className="capitalize">{key}</span><input type={key === 'email' ? 'email' : 'text'} className={ui.input} value={form[key] || ''} maxLength={key === 'email' ? 254 : 120} onChange={event => update(key, event.target.value)} /></label>)}</div>
            <div className="grid items-start gap-4 lg:grid-cols-2">{protocols.map(protocol => {
                const Icon = protocol === 'smtp' ? Send : Inbox;
                return <section key={protocol} aria-label={`${protocol.toUpperCase()} configuration`} className="min-w-0 space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className={`${ui.title} flex items-center gap-2`}><Icon size={16} className="text-indigo-500" />{protocol.toUpperCase()}<span className={ui.muted}>{protocol === 'smtp' ? 'Outgoing' : 'Incoming'}</span></h3><label className="flex items-center gap-2 text-xs font-medium"><input className={ui.checkbox} type="checkbox" checked={form[`${protocol}Enabled`] === true} onChange={event => update(`${protocol}Enabled`, event.target.checked)} /> Enable {protocol.toUpperCase()}</label></div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px]">{(['Host', 'Port', 'Username', 'Password'] as const).map(field => { const key = `${protocol}${field}` as const; return <label key={key} className={`${ui.label} ${field === 'Username' || field === 'Password' ? 'sm:col-span-2' : ''}`}>{protocol.toUpperCase()} {field}{field === 'Password' && initialData[key] ? ' (saved secret present; blank retains)' : ''}<input className={ui.input} type={field === 'Password' ? 'password' : field === 'Port' ? 'number' : 'text'} autoComplete={field === 'Password' ? 'new-password' : 'off'} value={form[key] ?? ''} maxLength={1000} onChange={event => update(key, field === 'Port' ? event.target.value === '' ? undefined : Number(event.target.value) : event.target.value)} /></label>; })}</div>
                    <label className="flex items-center gap-2 text-xs"><input className={ui.checkbox} type="checkbox" checked={form[`${protocol}Secure`] === true} onChange={event => update(`${protocol}Secure`, event.target.checked)} /><ShieldCheck size={14} className="text-emerald-500" /> Require verified TLS</label>
                    <button type="button" className={ui.secondary} disabled={!form[`${protocol}Host`] || !hasPermission('*')} onClick={() => void act(protocol === 'smtp' ? 'SMTP' : 'IMAP')}>Review {protocol.toUpperCase()} connection test</button>
                </section>;
            })}</div>
            <section className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className={`${ui.title} flex items-center gap-2`}><Globe size={16} className="text-indigo-500" />HTTPS relay</h3><p className={ui.muted}>Alternative to SMTP for outgoing mail.</p><div className="grid gap-3 sm:grid-cols-2">{(['relayEndpoint', 'relayApiKey', 'relayProfileId'] as const).map(key => <label key={key} className={`${ui.label} ${key === 'relayEndpoint' ? 'sm:col-span-2' : ''}`}><span>{key === 'relayEndpoint' ? 'Relay endpoint' : key === 'relayApiKey' ? 'Relay API key' : 'Relay profile ID'}</span><input aria-label={key} className={ui.input} type={key === 'relayApiKey' ? 'password' : 'text'} value={form[key] || ''} maxLength={key === 'relayEndpoint' ? 2000 : 1000} autoComplete="off" onChange={event => update(key, event.target.value)} /></label>)}</div><button type="button" className={ui.secondary} disabled={!form.relayEndpoint || !hasPermission('*')} onClick={() => void act('relay')}>Review relay test</button></section>
        </fieldset>
        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-700"><button type="button" className={ui.secondary} disabled={mutation.busy} onClick={cancel}>Discard / close</button><button type="button" className={ui.primary} disabled={busy} onClick={() => void act('save')}>Save reviewed account</button></div>
    </section>;
}
