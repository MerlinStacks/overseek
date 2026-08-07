import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, Loader2, LogOut, Minus, Plus, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { catalogViewService, type CatalogIdentityNotice, type CatalogPages, type CatalogPrompt } from './catalogViewService';
import { clampCatalogPage, CONFIDENTIALITY_AGREEMENT, isValidViewerEmail, nextCatalogViewStep, shouldLoadProtectedImageImmediately, type CatalogViewStep } from './catalogViewHelpers';

export function CatalogViewPage() {
    const { token = '' } = useParams();
    const [step, setStep] = useState<CatalogViewStep>('loading');
    const [prompt, setPrompt] = useState<CatalogPrompt | null>(null);
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [notice, setNotice] = useState<CatalogIdentityNotice | null>(null);
    const [agreed, setAgreed] = useState(false);
    const [pages, setPages] = useState<CatalogPages | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let active = true;
        catalogViewService.prompt(token).then(result => {
            if (!active) return;
            setPrompt(result); setStep('password');
        }).catch(() => { if (active) setStep('unavailable'); });
        return () => { active = false; };
    }, [token]);

    const submit = async (action: () => Promise<void>) => {
        setBusy(true); setError('');
        try { await action(); }
        catch { setError('Catalog is unavailable or access could not be verified. Check the details and try again.'); }
        finally { setBusy(false); }
    };

    const unlock = () => submit(async () => {
        const result = await catalogViewService.unlock(token, password);
        setPrompt(current => current ? { ...current, privacyNotice: result.privacyNotice } : current);
        setPassword(''); setStep(nextCatalogViewStep('password'));
    });
    const identify = () => submit(async () => {
        if (!name.trim() || !isValidViewerEmail(email)) throw new Error('Invalid identity');
        setNotice(await catalogViewService.identify(token, name.trim(), email.trim()));
        setStep(nextCatalogViewStep('identity'));
    });
    const accept = () => submit(async () => {
        if (!agreed) throw new Error('Agreement required');
        await catalogViewService.accept(token);
        setPages(await catalogViewService.pages(token));
        setStep(nextCatalogViewStep('consent'));
    });
    const logout = async () => {
        try { await catalogViewService.logout(token); } catch { /* Local state is cleared regardless. */ }
        setPages(null); setNotice(null); setAgreed(false); setStep('password');
    };

    if (step === 'loading') return <PublicShell><Loader2 className="animate-spin text-indigo-500" size={30} /><p className="mt-3 text-sm text-slate-500">Verifying secure catalog...</p></PublicShell>;
    if (step === 'unavailable') return <PublicShell><ShieldCheck className="text-slate-400" size={38} /><h1 className="mt-4 text-xl font-semibold text-slate-900">Catalog unavailable</h1><p className="mt-2 max-w-md text-sm leading-6 text-slate-600">Access could not be verified. The catalog may be locked, expired, revoked, suspended, or no longer available. Contact the sender for a current link.</p></PublicShell>;
    if (step === 'viewer' && pages) return <CatalogViewer token={token} title={prompt?.title || 'Confidential catalog'} pages={pages} onLogout={() => void logout()} />;

    return <PublicShell>
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white"><ShieldCheck size={24} /></div>
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-600">Protected catalog</div>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">{prompt?.title || 'Confidential catalog'}</h1>
        {step === 'password' && <form className="mt-7 space-y-4" onSubmit={event => { event.preventDefault(); void unlock(); }}><p className="text-sm leading-6 text-slate-600">Enter the password supplied with this catalog. Access attempts are security logged.</p><Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" /><Submit busy={busy} disabled={!password} label="Unlock catalog" /></form>}
        {step === 'identity' && <form className="mt-7 space-y-4" onSubmit={event => { event.preventDefault(); void identify(); }}><Notice text={prompt?.privacyNotice || 'Viewer identity and catalog activity are recorded to protect this confidential catalog.'} /><p className="text-sm leading-6 text-slate-600">Your name, email, device/session details, page activity, and acceptance are recorded for confidentiality and access auditing.</p><Field label="Your name" value={name} onChange={setName} autoComplete="name" /><Field label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" /><Submit busy={busy} disabled={!name.trim() || !isValidViewerEmail(email)} label="Continue" /></form>}
        {step === 'consent' && notice && <form className="mt-7 space-y-5" onSubmit={event => { event.preventDefault(); void accept(); }}><Notice text={notice.privacyNotice} /><div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">{notice.confidentialityText}</div><label className="flex cursor-pointer items-start gap-3 text-sm font-medium text-slate-800"><input required type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} className="mt-1 h-4 w-4" /><span>{CONFIDENTIALITY_AGREEMENT}</span></label><Submit busy={busy} disabled={!agreed} label="Accept and view catalog" /></form>}
        {error && <div role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {prompt?.expiresAt && <p className="mt-6 text-xs text-slate-400">Access expires {new Date(prompt.expiresAt).toLocaleString()}.</p>}
    </PublicShell>;
}

function CatalogViewer({ token, title, pages, onLogout }: { token: string; title: string; pages: CatalogPages; onLogout: () => void }) {
    const [page, setPage] = useState(1);
    const [zoom, setZoom] = useState(1);
    const [entry, setEntry] = useState('1');
    const [imageError, setImageError] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => setEntry(String(page)), [page]);
    const go = (value: number) => { const next = clampCatalogPage(value, pages.pageCount); setPage(next); setEntry(String(next)); setImageError(false); };
    const fullscreen = () => root.current?.requestFullscreen?.().catch(() => undefined);
    return <div ref={root} onContextMenu={event => event.preventDefault()} className="fixed inset-0 z-[100] flex select-none flex-col overflow-hidden bg-slate-950 text-white print:hidden">
        {pages.expiredPricing && <div role="alert" className="shrink-0 bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950">Pricing in this catalog has expired. Contact the sender for current pricing.</div>}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-slate-900 px-3 sm:px-5"><div className="min-w-0"><div className="truncate text-sm font-semibold">{title}</div><div className="text-[11px] text-slate-400">Viewing as {pages.viewer.name} · expires {new Date(pages.expiresAt).toLocaleDateString()}</div></div><div className="flex items-center gap-1"><button onClick={fullscreen} title="Fullscreen" className={toolClass}><Expand size={17} /></button><button onClick={onLogout} title="Log out" className={`${toolClass} sm:w-auto sm:px-3`}><LogOut size={17} /><span className="hidden sm:inline">Log out</span></button></div></header>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <aside className="order-2 flex h-24 shrink-0 gap-2 overflow-x-auto border-t border-white/10 bg-slate-900 p-2 md:order-1 md:h-auto md:w-40 md:flex-col md:overflow-y-auto md:border-r md:border-t-0">{Array.from({ length: pages.pageCount }, (_, index) => index + 1).map(number => <button key={number} onClick={() => go(number)} className={`relative h-20 w-28 shrink-0 overflow-hidden rounded border-2 bg-white md:h-auto md:w-full ${page === number ? 'border-indigo-400' : 'border-transparent opacity-70 hover:opacity-100'}`}><ProtectedImage token={token} page={number} thumbnail alt={`Page ${number} thumbnail`} /><span className="absolute bottom-0 right-0 bg-slate-950/80 px-1.5 py-0.5 text-[10px] text-white">{number}</span></button>)}</aside>
            <main className="order-1 min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_center,_#334155,_#0f172a_70%)] p-3 md:order-2 md:p-6"><div className="flex min-h-full min-w-full items-center justify-center"><div style={{ width: `${zoom * 100}%`, maxWidth: `${zoom * 1500}px` }} className="relative aspect-[1.414/1] overflow-hidden bg-white shadow-2xl"><ProtectedImage key={page} token={token} page={page} alt={`Catalog page ${page}`} onError={() => setImageError(true)} />{imageError && <div className="absolute inset-0 flex items-center justify-center bg-slate-100 p-6 text-center text-sm text-slate-600">This page is unavailable. The session may have expired. Log out and use the current credentials to try again.</div>}</div></div></main>
        </div>
        <footer className="flex h-14 shrink-0 items-center justify-center gap-2 border-t border-white/10 bg-slate-900 px-2"><button disabled={page <= 1} onClick={() => go(page - 1)} className={toolClass}><ChevronLeft size={18} /></button><form onSubmit={event => { event.preventDefault(); go(Number(entry)); }} className="flex items-center gap-2 text-xs"><input aria-label="Page number" inputMode="numeric" value={entry} onChange={event => setEntry(event.target.value)} className="w-12 rounded border border-white/20 bg-slate-800 px-2 py-1.5 text-center text-white" /><span className="text-slate-400">of {pages.pageCount}</span></form><button disabled={page >= pages.pageCount} onClick={() => go(page + 1)} className={toolClass}><ChevronRight size={18} /></button><span className="mx-1 h-5 w-px bg-white/10" /><button disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))} className={toolClass}><Minus size={17} /></button><span className="w-11 text-center text-xs text-slate-400">{Math.round(zoom * 100)}%</span><button disabled={zoom >= 2.5} onClick={() => setZoom(value => Math.min(2.5, value + 0.25))} className={toolClass}><Plus size={17} /></button></footer>
    </div>;
}

function ProtectedImage({ token, page, thumbnail = false, alt, onError }: { token: string; page: number; thumbnail?: boolean; alt: string; onError?: () => void }) {
    const [url, setUrl] = useState('');
    const target = useRef<HTMLDivElement>(null);
    const observerAvailable = typeof IntersectionObserver !== 'undefined';
    const [shouldLoad, setShouldLoad] = useState(() => shouldLoadProtectedImageImmediately(thumbnail, observerAvailable));
    const reportError = useEffectEvent(() => onError?.());
    useEffect(() => {
        if (shouldLoad || !target.current) return;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) setShouldLoad(true);
        }, { rootMargin: '160px' });
        observer.observe(target.current);
        return () => observer.disconnect();
    }, [shouldLoad]);
    useEffect(() => {
        if (!shouldLoad) return;
        let active = true; let objectUrl = '';
        catalogViewService.image(token, page, thumbnail).then(blob => { objectUrl = URL.createObjectURL(blob); if (active) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl); }).catch(() => { if (active) reportError(); });
        return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [page, shouldLoad, thumbnail, token]);
    return url ? <img draggable={false} src={url} alt={alt} className="h-full w-full object-contain" /> : <div ref={target} role="img" aria-label={alt} className="flex h-full w-full items-center justify-center bg-slate-100">{shouldLoad && <Loader2 className="animate-spin text-slate-400" size={thumbnail ? 16 : 28} />}</div>;
}

function PublicShell({ children }: { children: React.ReactNode }) { return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4 text-left"><section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 shadow-xl sm:p-10">{children}</section></main>; }
function Notice({ text }: { text: string }) { return <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm leading-6 text-indigo-950"><div className="mb-1 font-semibold">Privacy and activity notice</div>{text}</div>; }
function Field({ label, value, onChange, type = 'text', autoComplete }: { label: string; value: string; onChange: (value: string) => void; type?: string; autoComplete?: string }) { return <label className="block text-sm font-medium text-slate-700">{label} *<input required type={type} autoComplete={autoComplete} value={value} onChange={event => onChange(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" /></label>; }
function Submit({ busy, disabled, label }: { busy: boolean; disabled: boolean; label: string }) { return <button disabled={busy || disabled} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy && <Loader2 className="animate-spin" size={17} />}{label}</button>; }
const toolClass = 'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-2 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-30';
