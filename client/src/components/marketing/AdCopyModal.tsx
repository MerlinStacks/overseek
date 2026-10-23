import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useRecoveryAttempt } from '../../hooks/useRecoveryAttempt';
import type { GeneratedCopy, TonePreset, Platform } from './adCopyTypes';
import { GeneratedCopyDisplay } from './GeneratedCopyDisplay';
import { validateGeneratedCopy } from './adCopyValidation';

interface AdCopyModalProps { isOpen: boolean; onClose: () => void; productId?: string; productName?: string; onCopyGenerated?: (copy: GeneratedCopy) => void }
export function AdCopyModal(props: AdCopyModalProps) {
    const { user, token } = useAuth(); const { currentAccount } = useAccount();
    if (!props.isOpen || !token || !currentAccount) return null;
    return <ScopedAdCopyModal key={JSON.stringify([user?.id, token, currentAccount.id, props.productId, props.productName])} {...props} token={token} accountId={currentAccount.id} />;
}
function ScopedAdCopyModal({ onClose, productId, productName, onCopyGenerated, token, accountId }: AdCopyModalProps & { token: string; accountId: string }) {
    const [tones, setTones] = useState<TonePreset[]>([]), [platforms, setPlatforms] = useState<Platform[]>([]);
    const [tone, setTone] = useState('professional'), [platform, setPlatform] = useState('google');
    const [copy, setCopy] = useState<GeneratedCopy | null>(null), [copied, setCopied] = useState(new Set<string>());
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
    const attempt = useRecoveryAttempt(), dialog = useRef<HTMLDialogElement>(null), live = useRef(false), copySequence = useRef(0);
    const headers = { Authorization: `Bearer ${token}`, 'x-account-id': accountId, 'Content-Type': 'application/json' };
    useEffect(() => {
        live.current = true;
        const previous = document.activeElement as HTMLElement | null;
        const element = dialog.current; element?.showModal();
        return () => { live.current = false; element?.close(); previous?.focus(); };
    }, []);
    useEffect(() => {
        let disposed = false;
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
        const get = async (path: string) => {
            const res = await fetch(`/api/ads/copy/${path}`, { signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId } });
            const result = await res.json(); if (!res.ok || !Array.isArray(result?.data) || result.data.length > 30 || result.data.some((item: TonePreset) => !item || !/^[a-z0-9_-]{1,80}$/.test(item.id) || typeof item.name !== 'string' || item.name.length > 200 || path === 'tone-presets' && (typeof item.description !== 'string' || item.description.length > 1000))) throw new Error('Invalid options');
            return result.data;
        };
        void Promise.all([get('tone-presets'), get('platforms')]).then(([t, p]) => {
            if (controller.signal.aborted) return; setTones(t); setPlatforms(p);
            if (t.length) setTone(t[0].id); if (p.length) setPlatform(p[0].id);
        }).catch(() => { if (!disposed) setError('Generation options unavailable. Close and reopen to retry.'); }).finally(() => clearTimeout(timer));
        return () => { disposed = true; controller.abort(); clearTimeout(timer); };
    }, [token, accountId]);
    async function generate() {
        if (!tones.some(item => item.id === tone) || !platforms.some(item => item.id === platform) || (productId?.length ?? 0) > 200 || (productName?.length ?? 0) > 1000) return;
        const request = attempt.begin(); if (!request) return;
        const timer = setTimeout(() => request.abort(), 30000); setBusy(true); setError(''); setCopy(null); setCopied(new Set()); copySequence.current++;
        try {
            const res = await fetch('/api/ads/copy/generate', { method: 'POST', signal: request.signal, headers, body: JSON.stringify({ productId, productName: productId ? undefined : productName, tonePreset: tone, platform }) });
            const data = await res.json(); if (!res.ok) throw new Error('Generation failed');
            const generated = validateGeneratedCopy(data?.data);
            if (!attempt.current(request)) return; setCopy(generated); onCopyGenerated?.(generated);
        } catch { if (attempt.current(request, true)) setError('Generation was not acknowledged. No automatic retry was made.'); }
        finally { clearTimeout(timer); attempt.finish(); if (attempt.current(request, true)) setBusy(false); }
    }
    async function clipboard(text: string, key: string) {
        const sequence = ++copySequence.current;
        try { await navigator.clipboard.writeText(text); if (live.current && sequence === copySequence.current) { setCopied(new Set([key])); setStatus('Copied to clipboard.'); } }
        catch { if (live.current && sequence === copySequence.current) { setCopied(new Set()); setStatus('Could not copy. Select and copy the text manually.'); } }
    }
    return <dialog ref={dialog} aria-labelledby="ad-copy-title" onCancel={event => { event.preventDefault(); onClose(); }} className="m-auto w-[calc(100%-2rem)] max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white p-6 backdrop:bg-black/50">
        <div className="flex justify-between gap-4"><h2 id="ad-copy-title" className="text-lg font-semibold">AI Ad Copy Generator</h2><button type="button" onClick={onClose} aria-label="Close ad copy generator">Close</button></div>
        <p>{productName || 'Generate copy for your store'}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-4">
            <label>Tone<select disabled={busy} value={tone} onChange={e => setTone(e.target.value)} className="block w-full bg-white dark:bg-slate-800 border rounded p-2">{tones.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Platform<select disabled={busy} value={platform} onChange={e => setPlatform(e.target.value)} className="block w-full bg-white dark:bg-slate-800 border rounded p-2">{platforms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        <button type="button" disabled={busy || !tones.length || !platforms.length} onClick={() => void generate()} className="rounded bg-[var(--primary-color)] text-[var(--primary-foreground)] px-4 py-2 disabled:opacity-50">{busy ? 'Generating…' : 'Generate Ad Copy'}</button>
        {error && <p role="alert">{error}</p>}<p role="status">{status}</p>
        {copy && <div className="bg-gray-900 text-white p-4 rounded-xl"><GeneratedCopyDisplay generatedCopy={copy} copiedItems={copied} onCopy={(text, key) => void clipboard(text, key)} onCopyAll={() => void clipboard([...copy.headlines, ...copy.descriptions, ...(copy.primaryTexts || [])].join('\n'), 'all')} /></div>}
        <p className="text-sm mt-4">AI or template suggestions require review before publication. Nothing is published here.</p>
    </dialog>;
}
export default AdCopyModal;
