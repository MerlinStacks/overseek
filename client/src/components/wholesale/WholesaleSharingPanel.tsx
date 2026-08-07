import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Bell, BellOff, Check, Copy, Download, KeyRound, Loader2, RefreshCw, Search, Send, ShieldOff } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import type { createWholesaleCatalogService } from '../../services/wholesaleCatalogService';
import type { WholesaleCatalogGeneration, WholesaleCatalogShare, WholesaleCustomerSearchResult, WholesaleShareDetail, WholesaleShareStatus } from '../../types/wholesaleCatalog';
import { absoluteShareExpiry, canActivateShare, defaultShareExpiry, isPreparingShare, isValidShareExpiry, shareStatusLabel, shareableGenerations, toLocalDateTime } from './shareHelpers';
import { needsDownloadedArtifactWarning, recordDownloadedArtifactWarning } from './wholesaleEditorHelpers';
import { areShareNotificationsEnabled } from './productUxHelpers';

type Service = ReturnType<typeof createWholesaleCatalogService>;
const SharingServiceContext = createContext<Service | null>(null);

export function WholesaleSharingPanel({ catalogId, service, canGenerate }: { catalogId: string; service: Service; canGenerate: boolean }) {
    const toast = useToast();
    const [generations, setGenerations] = useState<WholesaleCatalogGeneration[]>([]);
    const [shares, setShares] = useState<WholesaleCatalogShare[]>([]);
    const [details, setDetails] = useState<Record<string, WholesaleShareDetail>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [customers, setCustomers] = useState<WholesaleCustomerSearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [customer, setCustomer] = useState<WholesaleCustomerSearchResult | null>(null);
    const [generationId, setGenerationId] = useState('');
    const [expiresAt, setExpiresAt] = useState(() => toLocalDateTime(defaultShareExpiry()));
    const [busyId, setBusyId] = useState<string | null>(null);
    const [activating, setActivating] = useState<WholesaleCatalogShare | null>(null);
    const [revealed, setRevealed] = useState<{ url: string; password: string } | null>(null);

    const load = useCallback(async (showLoading = false) => {
        if (showLoading) setLoading(true);
        try {
            const [generationResult, shareResult] = await Promise.all([service.listGenerations(), service.listShares(catalogId)]);
            setGenerations(generationResult.generations);
            setShares(shareResult.shares);
            setError('');
            const detailResults = await Promise.allSettled(shareResult.shares.map(share => service.getShare(share.id)));
            setDetails(Object.fromEntries(detailResults.flatMap(result => result.status === 'fulfilled' ? [[result.value.share.id, result.value]] : [])));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to load catalog shares.');
        } finally {
            if (showLoading) setLoading(false);
        }
    }, [catalogId, service]);

    useEffect(() => { void load(true); }, [load]);
    const hasPreparing = shares.some(isPreparingShare);
    useEffect(() => {
        if (!hasPreparing) return;
        const poll = () => { if (document.visibilityState === 'visible') void load(); };
        const interval = window.setInterval(poll, 4000);
        document.addEventListener('visibilitychange', poll);
        return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', poll); };
    }, [hasPreparing, load]);

    useEffect(() => {
        if (query.trim().length < 2 || customer) { setCustomers([]); return; }
        const timer = window.setTimeout(() => {
            if (document.visibilityState !== 'visible') return;
            setSearching(true);
            service.searchCustomers(query.trim()).then(result => setCustomers(result.customers)).catch(reason => toast.error(reason instanceof Error ? reason.message : 'Customer search failed.')).finally(() => setSearching(false));
        }, 300);
        return () => window.clearTimeout(timer);
    }, [customer, query, service, toast]);

    const available = shareableGenerations(generations, catalogId);
    useEffect(() => {
        if (!generationId && available[0]) setGenerationId(available[0].id);
    }, [available, generationId]);

    const run = async (id: string, action: () => Promise<unknown>, message: string) => {
        setBusyId(id);
        try { await action(); toast.success(message); await load(); return true; }
        catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Share action failed.'); return false; }
        finally { setBusyId(null); }
    };

    const prepare = () => {
        if (!customer || !generationId || !isValidShareExpiry(expiresAt)) {
            toast.error('Choose a customer, an approved current generation, and a future expiry within 90 days.');
            return;
        }
        void run('prepare', () => service.prepareShare(generationId, customer.id, new Date(expiresAt).toISOString()), 'Customer-specific catalog preparation started.').then(success => {
            if (success) { setCustomer(null); setQuery(''); setExpiresAt(toLocalDateTime(defaultShareExpiry())); }
        });
    };

    const download = async (share: WholesaleCatalogShare) => {
        try {
            if (needsDownloadedArtifactWarning(window.localStorage)) {
                if (!window.confirm('Previously downloaded PDF files cannot be updated or revoked. Continue?')) return;
                recordDownloadedArtifactWarning(window.localStorage);
            }
        } catch { if (!window.confirm('Previously downloaded PDF files cannot be updated or revoked. Continue?')) return; }
        setBusyId(`download-${share.id}`);
        try {
            const blob = await service.downloadShare(share.id);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a'); link.href = url; link.download = share.personalizedFileName || 'customer-catalog.pdf'; link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Unable to download customer catalog.'); }
        finally { setBusyId(null); }
    };

    return <SharingServiceContext.Provider value={service}><section className="space-y-5 border-t border-slate-200 pt-7 dark:border-slate-700">
        <div><h3 className="text-lg font-semibold text-slate-900 dark:text-white">Secure customer sharing</h3><p className="mt-1 text-sm text-slate-500">Prepare a customer-watermarked artifact before emailing a password-protected viewer link. The link and password are sent to the same customer email address.</p></div>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error} <button className="font-semibold underline" onClick={() => void load(true)}>Retry</button></div>}
        {loading ? <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="animate-spin" size={17} /> Loading shares...</div> : <>
            <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/60 lg:grid-cols-3">
                <label className="relative text-xs font-medium text-slate-600 dark:text-slate-300">Customer company, name, or email *
                    <div className="relative"><Search className="absolute left-3 top-3 text-slate-400" size={15} /><input value={query} onChange={event => { setQuery(event.target.value); setCustomer(null); }} placeholder="Search customers" className={`${inputClass} pl-9`} /></div>
                    {(searching || customers.length > 0) && <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">{searching ? <div className="p-3 text-slate-500">Searching...</div> : customers.map(result => <button type="button" key={result.id} onClick={() => { setCustomer(result); setQuery(result.company || result.contact || result.email); setCustomers([]); }} className="block w-full border-b border-slate-100 p-3 text-left last:border-0 hover:bg-indigo-50 dark:border-slate-700 dark:hover:bg-slate-800"><span className="block font-semibold text-slate-800 dark:text-slate-100">{result.company || result.contact}</span><span className="block truncate text-slate-500">{result.contact} · {result.email}</span></button>)}</div>}
                </label>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Approved generation *<select value={generationId} onChange={event => setGenerationId(event.target.value)} className={inputClass}><option value="">Choose generation</option>{available.map(generation => <option key={generation.id} value={generation.id}>v{generation.versionNumber} · valid to {formatDate(generation.validUntil)}</option>)}</select>{!available.length && <span className="mt-1 block text-amber-700 dark:text-amber-300">No approved, current, non-stale generation is available.</span>}</label>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Share expiry *<input required type="datetime-local" min={toLocalDateTime(new Date(Date.now() + 60_000))} max={toLocalDateTime(absoluteShareExpiry(new Date()))} value={expiresAt} onChange={event => setExpiresAt(event.target.value)} className={inputClass} /><span className="mt-1 block text-slate-500">Required, maximum 90 days from share creation.</span></label>
                <div className="lg:col-span-3 flex justify-end"><button disabled={!customer || !generationId || busyId !== null || !isValidShareExpiry(expiresAt)} onClick={prepare} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busyId === 'prepare' ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Prepare customer catalog</button></div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700"><table className="w-full min-w-[1250px] text-left text-xs"><thead className="bg-slate-50 uppercase tracking-wide text-slate-500 dark:bg-slate-800"><tr><th className="p-3">Status</th><th className="p-3">Recipient snapshot</th><th className="p-3">Created / expiry</th><th className="p-3">Delivery / access</th><th className="p-3">Engagement</th><th className="p-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{shares.map(share => {
                const detail = details[share.id];
                return <tr key={share.id} className="align-top"><td className="p-3"><ShareBadge status={share.status} />{share.artifactError && <div className="mt-1 max-w-48 text-red-600 dark:text-red-300">{share.artifactError}</div>}</td><td className="p-3"><div className="font-semibold text-slate-800 dark:text-slate-100">{share.customerSnapshot.company || '-'}</div><div>{share.customerSnapshot.contact || '-'}</div><div className="text-slate-500">{share.customerSnapshot.email}</div></td><td className="p-3"><div>{formatDateTime(share.createdAt)}</div><div className="text-slate-500">Expires {formatDateTime(share.expiresAt)}</div><ExpiryEditor share={share} busy={busyId !== null} onSave={value => run(`expiry-${share.id}`, () => service.changeShareExpiry(share.id, value), 'Share expiry updated.')} /></td><td className="p-3"><div>Emailed {formatOptional(share.emailedAt)}</div><div>First {formatOptional(firstAccess(detail))}</div><div>Last {formatOptional(lastAccess(detail, share))}</div></td><td className="p-3">{detail ? <><div>{detail.summary.viewerCount} viewers · {detail.summary.sessionCount} sessions · {detail.summary.deviceCount} devices</div><div>{detail.summary.uniquePages} pages · {detail.summary.completion}% completion · last page {detail.summary.lastPage || '-'}</div></> : <span className="text-slate-500">Unavailable</span>}</td><td className="p-3"><div className="flex justify-end gap-1">
                    {canActivateShare(share) && <button disabled={busyId !== null} onClick={() => { setActivating(share); setRevealed(null); }} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-indigo-600 hover:bg-indigo-50"><RefreshCw size={14} />{share.status === 'READY' ? 'Activate' : 'Resend'}</button>}
                    {canGenerate && share.artifactStatus === 'READY' && <button disabled={busyId !== null} onClick={() => void download(share)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-indigo-600 hover:bg-indigo-50"><Download size={14} /> PDF</button>}
                    {!['REVOKED', 'EXPIRED'].includes(share.status) && <button disabled={busyId !== null} onClick={() => window.confirm('Revoke this link and all active viewer sessions?') && void run(`revoke-${share.id}`, () => service.revokeShare(share.id), 'Share revoked.')} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-red-600 hover:bg-red-50"><ShieldOff size={14} /> Revoke</button>}
                </div></td></tr>;
            })}{!shares.length && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No customer shares yet.</td></tr>}</tbody></table></div>
        </>}
        {activating && <ActivationDialog share={activating} service={service} revealed={revealed} onRevealed={setRevealed} onClose={() => { setActivating(null); setRevealed(null); }} onActivated={() => load()} />}
    </section></SharingServiceContext.Provider>;
}

function ActivationDialog({ share, service, revealed, onRevealed, onClose, onActivated }: { share: WholesaleCatalogShare; service: Service; revealed: { url: string; password: string } | null; onRevealed: (value: { url: string; password: string }) => void; onClose: () => void; onActivated: () => Promise<void> }) {
    const toast = useToast();
    const [mode, setMode] = useState<'generated' | 'custom'>('generated');
    const [password, setPassword] = useState('');
    const [subject, setSubject] = useState('[Catalog] prepared for [Company]');
    const [introduction, setIntroduction] = useState('[Catalog] prepared for [Company]');
    const [busy, setBusy] = useState(false);
    const activate = async () => {
        if (mode === 'custom' && password.trim().length < 12) { toast.error('Custom password must be at least 12 characters and not obvious or common.'); return; }
        setBusy(true);
        try {
            const input = { ...(mode === 'custom' ? { password: password.trim() } : {}), subject, introduction };
            const result = share.status === 'READY' ? await service.activateShare(share.id, input) : await service.resendShare(share.id, input);
            onRevealed(result); toast.success(share.status === 'READY' ? 'Share activated and emailed.' : 'Share resent with a rotated password and sessions.'); await onActivated();
        } catch (reason) { toast.error(reason instanceof Error ? reason.message : share.status === 'READY' ? 'Unable to activate share.' : 'Unable to resend share.'); }
        finally { setBusy(false); }
    };
    return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/65 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">{revealed ? <div className="space-y-5"><div><Check className="mb-2 text-emerald-600" /><h3 className="text-xl font-bold text-slate-900 dark:text-white">Credentials created</h3><p className="mt-1 text-sm text-slate-500">These values are shown once. The customer received both at {share.customerSnapshot.email}.</p></div><CopyValue label="Viewer link" value={revealed.url} /><CopyValue label="Password" value={revealed.password} /><button onClick={onClose} className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white">Close</button></div> : <div className="space-y-4"><div><h3 className="text-xl font-bold text-slate-900 dark:text-white">{share.status === 'READY' ? 'Activate secure share' : 'Resend and rotate access'}</h3><p className="mt-1 text-sm text-slate-500">Resending creates a new password and link and revokes all existing viewer sessions. Link and password are delivered to the same email address.</p></div><div className="flex gap-4 text-sm text-slate-700 dark:text-slate-200"><label><input type="radio" checked={mode === 'generated'} onChange={() => setMode('generated')} /> Generated four-word password</label><label><input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} /> Custom password</label></div>{mode === 'custom' && <label className="block text-sm text-slate-600 dark:text-slate-300">Password *<input type="password" minLength={12} maxLength={200} value={password} onChange={event => setPassword(event.target.value)} className={inputClass} /><span className="text-xs text-slate-500">At least 12 characters; obvious and common passwords are rejected.</span></label>}<label className="block text-sm text-slate-600 dark:text-slate-300">Email subject *<input maxLength={300} value={subject} onChange={event => setSubject(event.target.value)} className={inputClass} /></label><label className="block text-sm text-slate-600 dark:text-slate-300">Introduction *<textarea rows={4} maxLength={3000} value={introduction} onChange={event => setIntroduction(event.target.value)} className={inputClass} /></label><div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-lg px-4 py-2 text-slate-600">Cancel</button><button disabled={busy || !subject.trim() || !introduction.trim()} onClick={() => void activate()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy && <Loader2 className="animate-spin" size={16} />}{share.status === 'READY' ? 'Activate and email' : 'Resend and rotate'}</button></div></div>}</div></div>;
}

function ExpiryEditor({ share, busy, onSave }: { share: WholesaleCatalogShare; busy: boolean; onSave: (value: string) => void }) {
    const service = useContext(SharingServiceContext);
    const toast = useToast();
    const [value, setValue] = useState(() => toLocalDateTime(new Date(share.expiresAt)));
    const [notificationsEnabled, setNotificationsEnabled] = useState(() => areShareNotificationsEnabled(share.customerSnapshot.notificationsMuted));
    const [preferenceBusy, setPreferenceBusy] = useState(false);
    const [rotationBusy, setRotationBusy] = useState(false);
    const [credentials, setCredentials] = useState<{ url: string; password: string } | null>(null);
    const changed = new Date(value).getTime() !== new Date(share.expiresAt).getTime();
    const toggleNotifications = async (enabled: boolean) => {
        if (!service) return;
        setPreferenceBusy(true);
        try { await service.setShareNotificationsMuted(share.id, !enabled); setNotificationsEnabled(enabled); toast.success(`Viewer notifications ${enabled ? 'enabled' : 'muted'}.`); }
        catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Unable to update notifications.'); }
        finally { setPreferenceBusy(false); }
    };
    const rotatePassword = async () => {
        if (!service || !window.confirm('Rotate this share password and link, and revoke active viewer sessions? No email will be sent.')) return;
        setRotationBusy(true);
        try { setCredentials(await service.rotateSharePassword(share.id)); toast.success('Password rotated without sending email.'); }
        catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Unable to rotate password.'); }
        finally { setRotationBusy(false); }
    };
    return <div className="mt-2 space-y-2"><div className="flex gap-1"><input aria-label={`Expiry for ${share.customerSnapshot.company}`} type="datetime-local" min={toLocalDateTime(new Date(Date.now() + 60_000))} max={toLocalDateTime(absoluteShareExpiry(share.createdAt))} value={value} onChange={event => setValue(event.target.value)} className="w-44 rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900" /><button title="Save expiry" disabled={busy || !changed || !isValidShareExpiry(value, new Date(share.createdAt))} onClick={() => onSave(new Date(value).toISOString())} className="rounded p-1 text-indigo-600 disabled:opacity-30"><Check size={14} /></button></div><label className="flex max-w-52 items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300"><input type="checkbox" checked={notificationsEnabled} disabled={busy || preferenceBusy} onChange={event => void toggleNotifications(event.target.checked)} className="mt-0.5" />{notificationsEnabled ? <Bell size={13} className="shrink-0 text-indigo-600" /> : <BellOff size={13} className="shrink-0" />}<span>First-open and new-viewer notifications {notificationsEnabled ? 'on' : 'muted'}. Access logging always remains on.</span></label>{share.activatedAt && !['REVOKED', 'EXPIRED'].includes(share.status) && <button type="button" disabled={busy || rotationBusy} onClick={() => void rotatePassword()} className="inline-flex items-center gap-1 rounded px-1 py-1 font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"><KeyRound size={13} /> {rotationBusy ? 'Rotating...' : 'Rotate password'}</button>}{credentials && <div className="max-w-64 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[10px] text-amber-950"><div className="font-bold">New credentials, shown once</div><div className="mt-1 break-all">{credentials.url}</div><div className="mt-1 font-mono">{credentials.password}</div><button type="button" onClick={() => setCredentials(null)} className="mt-1 font-semibold underline">Dismiss</button></div>}</div>;
}

function CopyValue({ label, value }: { label: string; value: string }) { const toast = useToast(); return <div><div className="mb-1 text-xs font-semibold uppercase text-slate-500">{label}</div><div className="flex rounded-lg border border-slate-200 dark:border-slate-700"><code className="min-w-0 flex-1 overflow-x-auto p-3 text-sm text-slate-800 dark:text-slate-100">{value}</code><button onClick={() => navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied.`)).catch(() => toast.error('Copy failed.'))} className="border-l border-slate-200 p-3 text-indigo-600 dark:border-slate-700"><Copy size={16} /></button></div></div>; }
function ShareBadge({ status }: { status: WholesaleShareStatus }) { const tone = status === 'ACTIVE' || status === 'READY' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : status === 'PREPARING' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : status === 'LOCKED' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'; return <span className={`rounded-full px-2 py-1 font-semibold ${tone}`}>{shareStatusLabel(status)}</span>; }
function firstAccess(detail?: WholesaleShareDetail) { return detail?.viewers.map(viewer => viewer.firstAccessedAt).filter(Boolean).sort()[0] || null; }
function lastAccess(detail: WholesaleShareDetail | undefined, share: WholesaleCatalogShare) { const values = detail?.viewers.map(viewer => viewer.lastAccessedAt).filter(Boolean).sort() || []; return values[values.length - 1] || share.lastAccessedAt; }
function formatDate(value: string) { return new Date(value).toLocaleDateString(); }
function formatDateTime(value: string) { return new Date(value).toLocaleString(); }
function formatOptional(value: string | null | undefined) { return value ? formatDateTime(value) : 'Never'; }
const inputClass = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
