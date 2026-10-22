import { useEffect, useRef, useState } from 'react';
import type { EmailDesignV2Envelope, EmailDeliveryPreviewOptions } from '../../../lib/emailDesignerV2';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';

export interface DeliveryArtifact {
    html: string; canonicalHtml: string; subject: string; previewText: string; text: string;
    hash: string; rendererVersion: string; assets: string[]; missingTags: string[];
    designKey: string; orderId: string | null; scenario: string;
    deliveryOptionsKey: string;
    accountId: string;
    category: 'MARKETING' | 'TRANSACTIONAL';
    sender?: { fromName?: string; fromEmail?: string; replyToEmail?: string };
}
const scenarios = [['standard', 'Standard sample'], ['long-name', 'Long customer name'], ['no-images', 'Missing product images'], ['empty-cart', 'Empty cart'], ['many-items', '25 order items'], ['discounts', 'Discounted order'], ['no-estimate', 'No delivery estimate']];
export function DeliveryPreview({ design, width, category, deliveryOptions, onPrepared }: { design: EmailDesignV2Envelope; width: number; category: 'MARKETING' | 'TRANSACTIONAL'; deliveryOptions?: EmailDeliveryPreviewOptions; onPrepared: (value: DeliveryArtifact | null) => void }) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const designKey = JSON.stringify(design);
    const deliveryOptionsKey = JSON.stringify(deliveryOptions || {});
    const callback = useRef(onPrepared); callback.current = onPrepared;
    const [orders, setOrders] = useState<Array<{ id: string; number: string; label: string }>>([]);
    const [orderId, setOrderId] = useState(''); const [scenario, setScenario] = useState('standard');
    const [artifact, setArtifact] = useState<DeliveryArtifact | null>(null);
    const [error, setError] = useState(''); const [reload, setReload] = useState(0);
    const [imagesOff, setImagesOff] = useState(false); const [showText, setShowText] = useState(false);
    const [appearance, setAppearance] = useState('system');
    const scope = JSON.stringify([accountId, token, designKey, orderId, scenario, category, deliveryOptionsKey]);
    const [artifactScope, setArtifactScope] = useState('');
    useEffect(() => {
        const controller = new AbortController(); setOrders([]); setOrderId('');
        if (token && accountId) void fetch('/api/marketing/preview-orders', { signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId } }).then(async response => { if (!response.ok) return; const data = await response.json(); if (!controller.signal.aborted && Array.isArray(data.orders)) setOrders(data.orders); }).catch(() => {});
        return () => controller.abort();
    }, [accountId, token]);
    useEffect(() => {
        const controller = new AbortController(); setArtifact(null); setError(''); callback.current(null);
        if (!accountId || !token) return;
        const timeout = window.setTimeout(() => { setError('Delivery preparation timed out. Please retry.'); controller.abort(); }, 30000);
        const timer = window.setTimeout(() => {
            void fetch('/api/marketing/preview-email', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-account-id': accountId }, body: JSON.stringify({ designJson: JSON.parse(designKey), subject: design.document.meta.title, previewText: design.document.meta.previewText || '', category, orderId: orderId || null, scenario, ...(deliveryOptions ? { deliveryOptions: JSON.parse(deliveryOptionsKey) } : {}) }) }).then(async response => {
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Delivery preparation failed');
                if (!['html', 'canonicalHtml', 'subject', 'text', 'hash', 'rendererVersion'].every(key => typeof data[key] === 'string') || !Array.isArray(data.missingTags)) throw new Error('Invalid delivery preview response');
                if (!controller.signal.aborted) { const value = { ...data, designKey, deliveryOptionsKey, accountId, category }; setArtifact(value); setArtifactScope(scope); callback.current(value); }
            }).catch(err => { if (!controller.signal.aborted) setError(err.message); }).finally(() => window.clearTimeout(timeout));
        }, 450);
        return () => { window.clearTimeout(timer); window.clearTimeout(timeout); controller.abort(); };
    }, [accountId, token, designKey, orderId, scenario, category, deliveryOptionsKey, reload]);
    const current = artifactScope === scope ? artifact : null;
    let displayedHtml = current && imagesOff ? current.html.replace(/<img\b[^>]*>/gi, '<span style="display:inline-block;border:1px dashed #94a3b8;padding:8px;color:#64748b;">[Image blocked]</span>') : current?.html;
    if (appearance !== 'system') displayedHtml = displayedHtml?.replace(/@media\s*\(prefers-color-scheme:\s*dark\)/gi, appearance === 'dark' ? '@media all' : '@media not all');
    return <section aria-label="Delivery preview" className="mx-auto max-w-5xl space-y-3">
        <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <label className="min-w-0 flex-1 text-xs font-medium">Context<select aria-label="Delivery preview order" value={orderId} onChange={event => { setOrderId(event.target.value); setScenario('standard'); }} className="mt-1 block w-full rounded border bg-transparent p-2 text-sm"><option value="">Sample data · no real order</option>{orders.map(order => <option key={order.id} value={order.id}>#{order.number} · {order.label}</option>)}</select></label>
            <label className="text-xs font-medium">Stress scenario<select aria-label="Delivery preview scenario" disabled={!!orderId} value={scenario} onChange={event => setScenario(event.target.value)} className="mt-1 block rounded border bg-transparent p-2 text-sm">{scenarios.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={imagesOff} onChange={event => setImagesOff(event.target.checked)} />Simulate images blocked</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showText} onChange={event => setShowText(event.target.checked)} />Plain text</label>
            <label className="text-xs">Browser colour simulation<select value={appearance} onChange={event => setAppearance(event.target.value)} className="mt-1 block rounded border bg-transparent p-2 text-sm"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark CSS</option></select></label>
        </div>
        <p className="text-xs text-slate-500">Server-prepared output, not a Gmail/Outlook emulator. Preview tracking links are inert; test/live recipient IDs differ. Display simulations never change the saved email.</p>
        {error ? <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error} <button onClick={() => setReload(value => value + 1)} className="underline">Retry preparation</button></p> : !current ? <p role="status" className="p-8 text-center text-sm">Preparing delivery preview…</p> : <>
            <div className="rounded-lg bg-white p-3 text-sm dark:bg-slate-900"><strong>Subject:</strong> {current.subject}<p className="text-xs text-slate-500">Preview text: {current.previewText || 'Not set'}</p><p className="mt-1 break-all text-xs text-slate-500">{current.rendererVersion} · {new TextEncoder().encode(current.html).length.toLocaleString()} HTML bytes · hash {current.hash.slice(0, 16)} · {current.assets.length} image references</p></div>
            {current.sender && <p className="text-xs text-slate-500">From: {current.sender.fromName} {current.sender.fromEmail || '(configure a sending account)'}{current.sender.replyToEmail ? ` · Reply to: ${current.sender.replyToEmail}` : ''}</p>}
            {current.missingTags.length > 0 && <p role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-800">Missing values: {current.missingTags.join(', ')}</p>}
            {showText ? <pre className="whitespace-pre-wrap break-words rounded-xl bg-white p-5 text-sm dark:bg-slate-900">{current.text}</pre> : <div className="overflow-auto rounded-xl border border-slate-300 bg-slate-100 p-3 dark:border-slate-700 dark:bg-slate-950"><div className="mx-auto overflow-hidden bg-white" style={{ width }}><iframe title="Prepared delivery HTML preview" sandbox="" srcDoc={displayedHtml} className="h-[70vh] w-full bg-white" /></div></div>}
        </>}
    </section>;
}
