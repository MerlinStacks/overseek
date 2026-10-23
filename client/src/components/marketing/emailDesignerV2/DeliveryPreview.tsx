import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
export function DeliveryPreview({ design, width, category, deliveryOptions, onPrepared, contextContainer }: { design: EmailDesignV2Envelope; width: number; category: 'MARKETING' | 'TRANSACTIONAL'; deliveryOptions?: EmailDeliveryPreviewOptions; onPrepared: (value: DeliveryArtifact | null) => void; contextContainer?: HTMLElement | null }) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const designKey = JSON.stringify(design);
    const deliveryOptionsKey = JSON.stringify(deliveryOptions || {});
    const callback = useRef(onPrepared); callback.current = onPrepared;
    const [orders, setOrders] = useState<Array<{ id: string; number: string; label: string }>>([]);
    const [orderId, setOrderId] = useState(''); const scenario = 'standard';
    const [artifact, setArtifact] = useState<DeliveryArtifact | null>(null);
    const [error, setError] = useState(''); const [reload, setReload] = useState(0);
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
    const contextSelector = <select aria-label="Delivery preview order" value={orderId} onChange={event => setOrderId(event.target.value)} className="w-full max-w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><option value="">Sample data · no real order</option>{orders.map(order => <option key={order.id} value={order.id}>#{order.number} · {order.label}</option>)}</select>;
    return <section aria-label="Delivery preview" className="mx-auto max-w-5xl space-y-3">
        {contextContainer ? createPortal(contextSelector, contextContainer) : null}
        {error ? <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error} <button onClick={() => setReload(value => value + 1)} className="underline">Retry preparation</button></p> : !current ? <p role="status" className="p-8 text-center text-sm">Preparing delivery preview…</p> : <>
            <div className="overflow-auto rounded-xl border border-slate-300 bg-slate-100 p-3 dark:border-slate-700 dark:bg-slate-950"><div className="mx-auto overflow-hidden bg-white" style={{ width }}><iframe title="Prepared delivery HTML preview" sandbox="" srcDoc={current.html} className="h-[70vh] w-full bg-white" /></div></div>
        </>}
    </section>;
}
