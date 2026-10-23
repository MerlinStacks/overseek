import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';

interface Props {
    html: string;
    subject?: string;
    previewText?: string;
    category: 'MARKETING' | 'TRANSACTIONAL';
    onPreviewed: () => void;
    onTestSent: () => void;
}
interface Preview { html: string; subject: string; previewText: string; orderId: string | null; missingTags?: string[] }

/** Read-only rendering uses the same resolver and explicit order as the test send. */
export function InlineEmailPreview(props: Props) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    return <ScopedEmailPreview key={`${currentAccount?.id}:${token}`} {...props} />;
}
function ScopedEmailPreview({ html, subject, previewText, category, onPreviewed, onTestSent }: Props) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const [orders, setOrders] = useState<Array<{ id: string; number: string; label: string }>>([]);
    const [orderId, setOrderId] = useState('');
    const [mobile, setMobile] = useState(false);
    const [preview, setPreview] = useState<Preview | null>(null);
    const [error, setError] = useState('');
    const [to, setTo] = useState('');
    const [sending, setSending] = useState(false);
    const [notice, setNotice] = useState('');
    const scope = JSON.stringify([accountId, token, html, subject, previewText, category, orderId]);
    const scopeRef = useRef(scope); scopeRef.current = scope;
    const [previewScope, setPreviewScope] = useState('');

    useEffect(() => {
        const controller = new AbortController();
        setOrders([]); setOrderId(''); setPreview(null); setTo(''); setNotice('');
        if (token && accountId) void fetch('/api/marketing/preview-orders', {
            signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId },
        }).then(async response => {
            if (!response.ok) throw new Error('Order choices unavailable; sample data is still available.');
            const result = await response.json();
            if (!controller.signal.aborted) setOrders(result.orders);
        }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
        return () => controller.abort();
    }, [accountId, token]);

    useEffect(() => {
        const controller = new AbortController();
        setPreview(null); setError(''); setNotice('');
        if (!html || !token || !accountId) return;
        const timer = window.setTimeout(() => {
            void fetch('/api/marketing/preview-email', {
                method: 'POST', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-account-id': accountId },
                body: JSON.stringify({ content: html, subject, previewText, orderId: orderId || null }),
            }).then(async response => {
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Preview unavailable');
                if (!controller.signal.aborted) { setPreview(result); setPreviewScope(scope); }
            }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
        }, 500);
        return () => { window.clearTimeout(timer); controller.abort(); };
    }, [accountId, token, html, subject, previewText, orderId, category]);

    const sendTest = async () => {
        if (!preview || previewScope !== scope || !accountId || sending) return;
        const sendScope = scope;
        setSending(true); setNotice(''); setError('');
        try {
            const response = await fetch('/api/marketing/test-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-account-id': accountId },
                body: JSON.stringify({ to: to.trim(), content: html, subject, previewText, category, orderId: preview.orderId }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Test send failed');
            if (scopeRef.current !== sendScope) return;
            setNotice('Test accepted for sending. Check the recipient inbox and message logs.');
            onTestSent();
        } catch (err) { if (scopeRef.current === sendScope) setError((err as Error).message); }
        finally { setSending(false); }
    };

    return <section aria-label="Live email preview" className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-gray-900">Preview & test</h4>
            <div role="group" aria-label="Preview device" className="flex gap-1">
                {['Desktop', 'Mobile'].map(device => <button key={device} type="button" aria-pressed={mobile === (device === 'Mobile')} onClick={() => setMobile(device === 'Mobile')} className={`rounded px-2 py-1 text-xs ${mobile === (device === 'Mobile') ? 'bg-[var(--primary-color)] text-[var(--primary-foreground)]' : 'bg-white text-gray-700'}`}>{device}</button>)}
            </div>
        </div>
        <label className="block text-xs font-medium text-gray-700">Preview customer/order
            <select value={orderId} onChange={event => setOrderId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2 text-sm">
                <option value="">Sample data (no real order)</option>
                {orders.map(order => <option key={order.id} value={order.id}>#{order.number} · {order.label}</option>)}
            </select>
        </label>
        <p className="text-xs text-gray-500">Order previews use that order’s billing customer. Cart and coupon examples are samples.</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {preview && previewScope === scope ? <>
            <div className="rounded-lg bg-white p-2 text-xs text-gray-700"><strong>Subject:</strong> {preview.subject || 'No subject'}<br /><strong>Preview text:</strong> {preview.previewText || 'Not set'}</div>
            {!!preview.missingTags?.length && <p role="alert" className="text-xs text-amber-800">Missing or unresolved values: {preview.missingTags.join(', ')}</p>}
            <iframe key={`${preview.orderId}:${preview.html}:${preview.subject}`} title="Inline email preview" sandbox="" srcDoc={preview.html} onLoad={onPreviewed} className={`mx-auto h-64 max-w-full rounded-lg border bg-white ${mobile ? 'w-[320px]' : 'w-full'}`} />
        </> : <p role="status" className="py-8 text-center text-sm text-gray-500">{html ? 'Loading preview…' : 'Add content to preview your email.'}</p>}
        <form onSubmit={event => { event.preventDefault(); void sendTest(); }} className="flex flex-wrap gap-2">
            <input type="email" required aria-label="Test email recipient" placeholder="Test recipient email" value={to} onChange={event => setTo(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <button type="submit" disabled={!preview || previewScope !== scope || sending || !to.trim() || !subject?.trim()} className="rounded-lg bg-[var(--primary-color)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50">{sending ? 'Sending…' : 'Send test'}</button>
        </form>
        {notice && <p role="status" className="text-xs text-green-700">{notice}</p>}
    </section>;
}
