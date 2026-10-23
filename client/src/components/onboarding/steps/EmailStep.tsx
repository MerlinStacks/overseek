import { useLayoutEffect, useRef, useState } from 'react';
import { type OnboardingStepProps, type EmailData } from '../types';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
import { useScopedMutation } from '../../../hooks/useScopedMutation';
import { isRecord } from '../../../utils/responseValidation';
import { workspaceStyles as ui } from '../../ui/workspaceStyles';

export function EmailStep(props: OnboardingStepProps) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount || props.draft.store.accountId !== currentAccount.id) return <p role="alert">Verify this store account before configuring email.</p>;
    return <ScopedEmailStep key={JSON.stringify([token, currentAccount.id])} {...props} token={token} accountId={currentAccount.id} />;
}
function ScopedEmailStep({ draft, setDraft, onNext, onBack, onSkip, isSubmitting, token, accountId }: OnboardingStepProps & { token: string; accountId: string }) {
    const mutation = useScopedMutation(); const [message, setMessage] = useState('');
    const [port, setPort] = useState(String(draft.email.smtpPort));
    const email = draft.email; const locked = mutation.busy || isSubmitting;
    const latest = useRef(email); useLayoutEffect(() => { latest.current = email; }, [email]);
    const change = (field: keyof EmailData, value: string | number | boolean) => {
        if (mutation.isPending() || isSubmitting) return;
        setMessage('');
        setDraft(current => ({ ...current, email: { ...current.email, [field]: value, verified: false, configured: false, verifiedAccountId: undefined } }));
    };
    const valid = email.enabled && !!email.smtpHost.trim() && !!email.smtpUsername.trim() && (!!email.smtpPassword || !!email.savedEmailId) && Number.isInteger(email.smtpPort) && email.smtpPort >= 1 && email.smtpPort <= 65535;
    const send = async (save: boolean) => {
        if (!valid || mutation.isPending() || isSubmitting) return;
        if (save && (!email.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.email))) return;
        const snapshot = JSON.stringify(email);
        const result = await mutation.run(async signal => {
            const headers = { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' };
            const response = await fetch(save ? `/api/email/accounts${email.savedEmailId ? `/${encodeURIComponent(email.savedEmailId)}` : ''}` : '/api/email/test', {
                method: save && email.savedEmailId ? 'PUT' : 'POST', headers, signal,
                body: JSON.stringify(save ? { name: email.name.trim(), email: email.email.trim(), smtpEnabled: true, smtpHost: email.smtpHost.trim(), smtpPort: email.smtpPort, smtpUsername: email.smtpUsername.trim(), ...(email.smtpPassword ? { smtpPassword: email.smtpPassword } : {}), smtpSecure: email.smtpSecure } : { id: email.savedEmailId, protocol: 'SMTP', host: email.smtpHost.trim(), port: email.smtpPort, username: email.smtpUsername.trim(), password: email.smtpPassword || '••••••••', isSecure: email.smtpSecure }),
            });
            const data: unknown = await response.json();
            if (!response.ok || !isRecord(data) || (save ? typeof data.id !== 'string' || !data.id : data.success !== true)) throw new Error('Email operation unconfirmed');
            return save ? data.id as string : null;
        }, save ? 'Could not confirm saving email. Check Settings → Email before creating another account.' : 'SMTP connection test failed. Check your settings and retry.');
        if (!result.ok || JSON.stringify(latest.current) !== snapshot) return;
        setDraft(current => JSON.stringify(current.email) === snapshot ? { ...current, email: { ...current.email, verifiedAccountId: accountId, ...(save ? { savedEmailId: result.value!, configured: true } : { verified: true }) } } : current);
        setMessage(save ? 'Sending account saved. Default sender selection can be changed in Settings → Email.' : 'Connection test passed. This does not save a sending account or verify delivery.');
    };
    const inputClass = ui.input;
    return <section className="space-y-5 text-slate-900 dark:text-slate-100"><h2 className="text-2xl font-bold">Email Setup</h2>
        <fieldset disabled={locked} className={`${ui.card} space-y-4`}>
            <label className="flex items-center gap-2 text-sm font-medium"><input className={ui.checkbox} type="checkbox" checked={email.enabled} onChange={event => change('enabled', event.target.checked)} />Enable email integration</label>
            {email.enabled && <>
                <div className="grid gap-4 sm:grid-cols-2">{([['name', 'Display Name'], ['email', 'Email Address'], ['smtpHost', 'SMTP Host'], ['smtpUsername', 'Username'], ['smtpPassword', 'Password']] as const).map(([field, label]) => <label className={ui.label} key={field}>{label}<input className={inputClass} type={field === 'smtpPassword' ? 'password' : field === 'email' ? 'email' : 'text'} autoComplete={field === 'smtpPassword' ? 'new-password' : 'off'} value={email[field]} onChange={event => change(field, event.target.value)} /></label>)}
                <label className={ui.label}>Port<input className={inputClass} type="number" min="1" max="65535" step="1" value={port} onChange={event => { setPort(event.target.value); change('smtpPort', event.target.value.trim() ? Number(event.target.value) : NaN); }} /></label></div>
                <label className="flex gap-2"><input type="checkbox" checked={email.smtpSecure} onChange={event => change('smtpSecure', event.target.checked)} />Use implicit TLS (typically port 465; otherwise SMTP STARTTLS)</label>
                <div className="flex flex-wrap gap-3"><button className={ui.secondary} type="button" disabled={!valid} onClick={() => void send(false)}>Test SMTP Connection</button><button className={ui.primary} type="button" disabled={!valid || !email.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.email) || !email.verified || email.verifiedAccountId !== accountId} onClick={() => void send(true)}>Save email configuration</button></div>
            </>}
        </fieldset>
        {mutation.busy && <p role="status">Working...</p>}{mutation.error && <p role="alert">{mutation.error}</p>}{message && <p role="status">{message}</p>}
        {!email.enabled && <p>Email is optional. Configure it later in Settings → Email.</p>}
        <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-700"><button className={ui.secondary} type="button" disabled={locked} onClick={onBack}>Back</button><button className={ui.secondary} type="button" disabled={locked} onClick={onSkip}>Skip for now</button><button className={ui.primary} type="button" disabled={locked || (email.enabled && (!email.configured || email.verifiedAccountId !== accountId))} onClick={onNext}>Continue</button></div>
    </section>;
}
