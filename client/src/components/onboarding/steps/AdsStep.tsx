import { useEffect, useRef, useState } from 'react';
import { OnboardingStepProps } from '../types';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { useScopedRequest } from '../../../hooks/useScopedRequest';
import { z } from 'zod';
import { workspaceStyles as ui } from '../../ui/workspaceStyles';
const connection = z.object({ id: z.string().min(1).max(200), platform: z.enum(['GOOGLE', 'META']), externalId: z.string().min(1).max(100) });
function decode(value: unknown) { return z.array(connection).max(100).parse(value); }
export function AdsStep(props: OnboardingStepProps) {
    const { token, user } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    if (!token || !currentAccount || !props.draft.store.connectionVerified || props.draft.store.accountId !== currentAccount.id) return <p role="alert">Verify this onboarding store account before managing advertising credentials.</p>;
    return <ScopedAds key={JSON.stringify([user?.id, token, currentAccount.id])} {...props} token={token} accountId={currentAccount.id} editable={hasPermission('manage_marketing')} />;
}
function ScopedAds({ token, accountId, editable, draft: _draft, setDraft, onNext, onBack, onSkip, isSubmitting }: OnboardingStepProps & { token: string; accountId: string; editable: boolean }) {
    const read = useScopedRequest('/api/ads', accountId, token, decode), [secret, setSecret] = useState(''), [externalId, setExternalId] = useState(''), [pending, setPending] = useState(false), [message, setMessage] = useState(''), [blocked, setBlocked] = useState(false);
    const lock = useRef(false), alive = useRef(true), controller = useRef<AbortController | null>(null), operation = useRef(crypto.randomUUID());
    useEffect(() => { alive.current = true; setDraft(previous => ({ ...previous, ads: { ...previous.ads, metaAccessToken: undefined } })); return () => { alive.current = false; controller.current?.abort(); }; }, [setDraft]);
    const run = async (kind: 'google' | 'meta') => {
        if (!editable || lock.current || blocked) return;
        if (kind === 'meta' && (!/^act_\d{1,30}$/.test(externalId.trim()) || secret.trim().length < 10 || secret.length > 4096)) { setMessage('Enter a bounded access token and act_ account identity.'); return; }
        lock.current = true; setPending(true); setMessage(''); controller.current = new AbortController(); const timeout = setTimeout(() => controller.current?.abort(), 30000);
        try {
            const response = await fetch(kind === 'google' ? `/api/oauth/google/authorize?${new URLSearchParams({ redirect: window.location.pathname + window.location.search })}` : '/api/ads/onboarding/meta', { method: kind === 'google' ? 'GET' : 'POST', signal: controller.current.signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' }, ...(kind === 'meta' ? { body: JSON.stringify({ operationId: operation.current, externalId: externalId.trim(), accessToken: secret.trim() }) } : {}) });
            if (!response.ok) throw new Error('unconfirmed'); const result: unknown = await response.json(); if (!alive.current) return;
            if (kind === 'google') { const value = z.object({ authUrl: z.string().max(4096) }).parse(result), url = new URL(value.authUrl); if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password) throw new Error('redirect'); window.location.assign(url.href); }
            else { const row = connection.extend({ credentialState: z.literal('saved-unverified') }).parse(result); if (row.platform !== 'META' || row.externalId !== externalId.trim()) throw new Error('identity'); setSecret(''); setDraft(previous => ({ ...previous, ads: { ...previous.ads, metaAccessToken: undefined, metaConnected: false, metaAdAccountId: row.externalId } })); operation.current = crypto.randomUUID(); setMessage('Credentials saved locally, but provider health/access is unverified. Review in Ad Accounts settings before use.'); read.retry(); }
        } catch { if (alive.current) { setBlocked(true); setSecret(''); setMessage(`Connection outcome unconfirmed. Reconcile operation ${operation.current} in account settings; do not blindly reconnect.`); } }
        finally { clearTimeout(timeout); lock.current = false; if (alive.current) setPending(false); }
    };
    const leave = (next: () => void) => { if ((pending || blocked || secret) && !window.confirm('Leave this step? Local credentials will be cleared. An admitted request may already have committed and is not rolled back.')) return; alive.current = false; controller.current?.abort(); setSecret(''); setDraft(previous => ({ ...previous, ads: { ...previous.ads, metaAccessToken: undefined } })); next(); };
    return <div className="space-y-5 text-slate-900 dark:text-slate-100"><h2 className="text-xl font-semibold">Advertising credentials (optional)</h2><p className={ui.muted}>Saved account rows do not prove a healthy provider connection. No provider validation is performed by this step.</p>{read.loading ? <p role="status">Loading saved account identities…</p> : read.error || !read.data ? <p className={ui.alert} role="alert">Saved identities unavailable. <button className={ui.secondary} type="button" onClick={read.retry}>Retry identities</button></p> : <ul className="flex flex-wrap gap-2">{read.data.map(row => <li className={`${ui.badge} break-all`} key={row.id}>{row.platform}: {row.externalId} · stored, health unverified</li>)}</ul>}{message && <p className={ui.notice} role="status">{message}</p>}
        <fieldset disabled={!editable || pending || blocked} className="grid items-start gap-4 sm:grid-cols-2"><section className={`${ui.card} space-y-4`}><h3 className={ui.title}>Google Ads</h3><p className={ui.muted}>Authorize access using your Google account.</p><button className={ui.secondary} type="button" onClick={() => void run('google')}>Start Google OAuth</button></section><section className={`${ui.card} space-y-4`}><h3 className={ui.title}>Meta Ads</h3><label className={ui.label}>Meta access token<input type="password" autoComplete="off" className={ui.input} maxLength={4096} value={secret} onChange={e => setSecret(e.target.value)} /></label><label className={ui.label}>Meta ad account ID<input className={ui.input} maxLength={34} value={externalId} onChange={e => setExternalId(e.target.value)} placeholder="act_123456789" /></label><button className={ui.secondary} type="button" onClick={() => void run('meta')}>Save Meta credentials (unverified)</button></section></fieldset>
        <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-700"><button className={ui.secondary} type="button" onClick={() => leave(onBack)}>Back</button><button className={ui.secondary} type="button" onClick={() => leave(onSkip)}>Skip for now</button><button className={ui.primary} type="button" disabled={isSubmitting || pending} onClick={() => leave(onNext)}>Continue</button></div></div>;
}
