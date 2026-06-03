import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Logger } from '../../utils/logger';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, Truck, CheckCircle, XCircle, Clock, MapPin, User, Mail, Phone, CreditCard, Copy, ExternalLink, X, TrendingUp, Globe, Smartphone, Monitor, Tablet, Tag, ChevronUp, ChevronDown, RotateCcw, Sparkles, FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useToast } from '../../context/ToastContext';
import { fixMojibake, formatCurrency, formatDateTime } from '../../utils/format';
import { usePermissions } from '../../hooks/usePermissions';
import { OrderCOGSPanel } from '../../components/orders/OrderCOGSPanel';
import { emitCrossTabEvent, subscribeToCrossTabEvents } from '../../utils/productCrossTabEvents';
import { getSafeHref } from '../../utils/url';

interface OrderApiLineItem {
    id: string;
    name?: string;
    quantity?: number;
    total?: string | number;
    price?: string | number;
    image?: { src?: string };
    sku?: string;
    meta_data?: OrderMetaData[];
}

interface Attribution {
    firstTouchSource: string;
    lastTouchSource: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    country?: string;
    city?: string;
    deviceType?: string;
}

interface OrderMetaData {
    key: string;
    value: string;
}

interface OrderLineItem {
    id: string;
    name: string;
    quantity: number;
    price: number;
    image?: string;
    sku?: string;
    meta_data?: OrderMetaData[];
}

interface TrackingItem {
    provider: string;
    trackingNumber: string;
    trackingUrl: string | null;
    dateShipped: string | null;
}

interface OrderDetail {
    id: string;
    orderNumber: string;
    status: string;
    createdAt: string;
    total: number;
    subtotal: number;
    shippingTotal: number;
    taxTotal: number;
    paymentMethod: string;
    customer: { name: string; email: string; phone?: string };
    billing: { address1: string; city: string; state: string; postcode: string; country: string };
    shipping: { address1: string; city: string; state: string; postcode: string; country: string };
    lineItems: OrderLineItem[];
    trackingItems: TrackingItem[];
    currency?: string;
}

type MobilePanelId = 'tracking' | 'customer' | 'shipping' | 'cogs' | 'tags' | 'attribution';
const DEFAULT_MOBILE_PANEL_ORDER: MobilePanelId[] = ['tracking', 'customer', 'shipping', 'cogs', 'tags', 'attribution'];

const STATUS_CONFIG: Record<string, { icon: typeof Package; color: string; bg: string; ring: string; text: string }> = {
    pending: { icon: Clock, color: 'text-amber-200', bg: 'bg-amber-500/15', ring: 'ring-amber-400/20', text: 'Pending' },
    processing: { icon: Package, color: 'text-sky-200', bg: 'bg-sky-500/15', ring: 'ring-sky-400/20', text: 'Processing' },
    shipped: { icon: Truck, color: 'text-violet-200', bg: 'bg-violet-500/15', ring: 'ring-violet-400/20', text: 'Shipped' },
    delivered: { icon: CheckCircle, color: 'text-emerald-200', bg: 'bg-emerald-500/15', ring: 'ring-emerald-400/20', text: 'Delivered' },
    completed: { icon: CheckCircle, color: 'text-emerald-200', bg: 'bg-emerald-500/15', ring: 'ring-emerald-400/20', text: 'Completed' },
    cancelled: { icon: XCircle, color: 'text-rose-200', bg: 'bg-rose-500/15', ring: 'ring-rose-400/20', text: 'Cancelled' },
};

export function MobileOrderDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();
    const [order, setOrder] = useState<OrderDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [attribution, setAttribution] = useState<Attribution | null>(null);
    const [orderTags, setOrderTags] = useState<string[]>([]);
    const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
    const [mobilePanelOrder, setMobilePanelOrder] = useState<MobilePanelId[]>(DEFAULT_MOBILE_PANEL_ORDER);
    const { hasPermission } = usePermissions();
    const canViewCogs = hasPermission('view_cogs');

    const fetchAttribution = useCallback(async () => {
        if (!currentAccount || !token || !id) {
            setAttribution(null);
            return;
        }
        try {
            const res = await fetch(`/api/orders/${id}/attribution`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (res.ok) {
                const data = await res.json();
                setAttribution(data.attribution);
            } else {
                setAttribution(null);
            }
        } catch {
            setAttribution(null);
            Logger.warn('[MobileOrderDetail] Could not load attribution');
        }
    }, [currentAccount, id, token]);

    const fetchOrder = useCallback(async () => {
        if (!currentAccount || !token || !id) {
            setOrder(null);
            setAttribution(null);
            setOrderTags([]);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setOrder(null);
            setAttribution(null);
            setOrderTags([]);
            const response = await fetch(`/api/orders/${id}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (!response.ok) throw new Error('Failed to fetch');
            const o = await response.json();

            setOrder({
                id: o.id,
                orderNumber: o.orderNumber || `#${String(o.id).slice(-6).toUpperCase()}`,
                status: o.status || 'pending',
                createdAt: o.date_created || o.createdAt,
                total: Number(o.total) || 0,
                subtotal: Number(o.subtotal) || 0,
                shippingTotal: Number(o.shipping_total || o.shippingTotal) || 0,
                taxTotal: Number(o.total_tax || o.taxTotal) || 0,
                paymentMethod: o.payment_method_title || o.paymentMethod || 'Unknown',
                customer: {
                    name: o.billing?.first_name ? `${o.billing.first_name} ${o.billing.last_name || ''}`.trim() : 'Guest',
                    email: o.billing?.email || '',
                    phone: o.billing?.phone
                },
                billing: { address1: o.billing?.address_1 || '', city: o.billing?.city || '', state: o.billing?.state || '', postcode: o.billing?.postcode || '', country: o.billing?.country || '' },
                shipping: { address1: o.shipping?.address_1 || o.billing?.address_1 || '', city: o.shipping?.city || o.billing?.city || '', state: o.shipping?.state || o.billing?.state || '', postcode: o.shipping?.postcode || o.billing?.postcode || '', country: o.shipping?.country || o.billing?.country || '' },
                lineItems: (o.line_items || []).map((item: OrderApiLineItem) => ({
                    id: item.id,
                    name: item.name || 'Unknown',
                    quantity: item.quantity || 1,
                    price: Number(item.total || item.price) || 0,
                    image: item.image?.src,
                    sku: item.sku,
                    meta_data: item.meta_data
                })),
                trackingItems: o.tracking_items || [],
                currency: o.currency
            });

            // Store tags separately for removal functionality
            setOrderTags(o.tags || []);

            // Fetch attribution data
            fetchAttribution();
        } catch (error) {
            setOrder(null);
            setAttribution(null);
            setOrderTags([]);
            Logger.error('[MobileOrderDetail] Error:', { error: error });
        } finally {
            setLoading(false);
        }
    }, [currentAccount, fetchAttribution, id, token]);

    useEffect(() => {
        fetchOrder();
        // Listen for refresh events from pull-to-refresh
        const handleRefresh = () => {
            fetchOrder();
        };
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [fetchOrder]);

    useEffect(() => {
        const unsubscribe = subscribeToCrossTabEvents((event) => {
            if (event.resource !== 'order' || event.accountId !== currentAccount?.id) {
                return;
            }

            if (!event.resourceId || event.resourceId === id) {
                void fetchOrder();
            }
        });

        return unsubscribe;
    }, [currentAccount?.id, fetchOrder, id]);

    useEffect(() => {
        const storageKey = `mobile-order-detail-panel-order:${currentAccount?.id || 'default'}`;
        const saved = localStorage.getItem(storageKey);

        if (!saved) {
            setMobilePanelOrder(DEFAULT_MOBILE_PANEL_ORDER);
            return;
        }

        try {
            const parsed = JSON.parse(saved);
            if (!Array.isArray(parsed)) {
                setMobilePanelOrder(DEFAULT_MOBILE_PANEL_ORDER);
                return;
            }

            const validOrder = parsed.filter((panelId): panelId is MobilePanelId =>
                typeof panelId === 'string' && DEFAULT_MOBILE_PANEL_ORDER.includes(panelId as MobilePanelId)
            );
            const missing = DEFAULT_MOBILE_PANEL_ORDER.filter((panelId) => !validOrder.includes(panelId));
            setMobilePanelOrder([...validOrder, ...missing]);
        } catch {
            setMobilePanelOrder(DEFAULT_MOBILE_PANEL_ORDER);
        }
    }, [currentAccount?.id]);

    useEffect(() => {
        const storageKey = `mobile-order-detail-panel-order:${currentAccount?.id || 'default'}`;
        localStorage.setItem(storageKey, JSON.stringify(mobilePanelOrder));
    }, [currentAccount?.id, mobilePanelOrder]);

    const formatDate = (date: string) => formatDateTime(date);
    const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); if ('vibrate' in navigator) navigator.vibrate(10); };

    const generateInvoice = async () => {
        if (!currentAccount || !token || !order) return;
        const orderId = Number(order.id);
        if (!Number.isFinite(orderId)) {
            toast.error('Unable to generate invoice for this order.');
            return;
        }

        setIsGeneratingInvoice(true);
        try {
            const res = await fetch(`/api/invoices/orders/${encodeURIComponent(String(orderId))}/generate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id, 'Content-Type': 'application/json' },
                body: JSON.stringify({ forceRegenerate: true })
            });
            const payload = await res.json().catch(() => null) as { artifact_download_url?: string; error?: string } | null;
            if (!res.ok) throw new Error(payload?.error || 'Failed to generate invoice');
            if (payload?.artifact_download_url) window.open(payload.artifact_download_url, '_blank', 'noopener,noreferrer');
            toast.success('Invoice generated.');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Invoice generation failed';
            Logger.error('[MobileOrderDetail] Invoice generation failed', { error: message });
            toast.error(message);
        } finally {
            setIsGeneratingInvoice(false);
        }
    };

    const removeTag = async (tag: string) => {
        if (!currentAccount || !token || !order) return;
        try {
            const res = await fetch(`/api/orders/${id}/tags/${encodeURIComponent(tag)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (res.ok) {
                const data = await res.json();
                setOrderTags(data.tags);
                emitCrossTabEvent({
                    resource: 'order',
                    type: 'tags-updated',
                    accountId: currentAccount.id,
                    resourceId: id,
                });
            }
        } catch (err) {
            Logger.error('Failed to remove tag', { error: err });
        }
    };

    const movePanel = useCallback((panelId: MobilePanelId, direction: 'up' | 'down') => {
        setMobilePanelOrder((prev) => {
            const index = prev.indexOf(panelId);
            if (index === -1) return prev;

            const targetIndex = direction === 'up' ? index - 1 : index + 1;
            if (targetIndex < 0 || targetIndex >= prev.length) return prev;

            const next = [...prev];
            [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
            return next;
        });
    }, []);

    if (loading) return <div className="space-y-4 animate-pulse"><div className="h-36 rounded-[2rem] bg-slate-900" /><div className="h-20 rounded-2xl bg-slate-900" /><div className="h-44 rounded-[1.5rem] bg-slate-900" /></div>;
    if (!order) return <div className="rounded-[2rem] border border-white/10 bg-slate-950 px-5 py-14 text-center"><Package className="mx-auto mb-4 text-slate-500" size={48} /><p className="text-lg font-black text-white">Order not found</p><button onClick={() => navigate('/m/orders')} className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950">Back to Orders</button></div>;

    const statusConfig = STATUS_CONFIG[order.status.toLowerCase()] || STATUS_CONFIG.pending;
    const StatusIcon = statusConfig.icon;
    const mobilePanels: Record<MobilePanelId, ReactNode | null> = {
            tracking: order.trackingItems.length > 0 ? (
                <div className="rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 shadow-lg shadow-black/20">
                    <div className="flex items-center gap-2 mb-3">
                        <Truck size={18} className="text-indigo-200" />
                        <h2 className="font-black text-white">Shipment Tracking</h2>
                    </div>
                    <div className="space-y-3">
                        {order.trackingItems.map((item, idx) => (
                            <div key={idx} className={`space-y-1.5 ${idx > 0 ? 'pt-3 border-t border-white/10' : ''}`}>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold uppercase text-slate-500">{item.provider}</span>
                                    {item.dateShipped && <span className="text-xs text-slate-500">Shipped {item.dateShipped}</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 truncate rounded-lg bg-white/[0.06] px-2 py-1 font-mono text-sm text-white">{item.trackingNumber}</code>
                                    <button onClick={() => copyToClipboard(item.trackingNumber)} className="rounded-lg p-1.5 text-slate-400 active:bg-white/10"><Copy size={14} /></button>
                                    {item.trackingUrl && (
                                        <a href={getSafeHref(item.trackingUrl)} target="_blank" rel="noopener noreferrer" className="rounded-lg p-1.5 text-indigo-200 active:bg-white/10"><ExternalLink size={14} /></a>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null,
            customer: (
                <div className="rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 shadow-lg shadow-black/20">
                    <h2 className="mb-3 font-black text-white">Customer</h2>
                    <div className="space-y-3">
                        <div className="flex items-center gap-3"><User size={18} className="text-slate-500" /><span className="text-slate-200">{order.customer.name}</span></div>
                        {order.customer.email && <a href={`mailto:${order.customer.email}`} className="flex items-center gap-3"><Mail size={18} className="text-slate-500" /><span className="text-indigo-200">{order.customer.email}</span></a>}
                        {order.customer.phone && <a href={`tel:${order.customer.phone}`} className="flex items-center gap-3"><Phone size={18} className="text-slate-500" /><span className="text-indigo-200">{order.customer.phone}</span></a>}
                    </div>
                </div>
            ),
            shipping: (
                <div className="rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 shadow-lg shadow-black/20">
                    <h2 className="mb-3 font-black text-white">Shipping Address</h2>
                    <div className="flex items-start gap-3"><MapPin size={18} className="mt-0.5 text-slate-500" /><div className="text-slate-300"><p>{order.shipping.address1 || 'No street address'}</p><p>{order.shipping.city}, {order.shipping.state} {order.shipping.postcode}</p><p>{order.shipping.country}</p></div></div>
                </div>
            ),
            cogs: canViewCogs ? <OrderCOGSPanel orderId={order.id} currency={order.currency} /> : null,
            tags: orderTags.length > 0 ? (
                <div className="rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 shadow-lg shadow-black/20">
                    <div className="flex items-center gap-2 mb-3">
                        <Tag size={18} className="text-indigo-200" />
                        <h2 className="font-black text-white">Tags</h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {orderTags.map((tag) => (
                            <span
                                key={tag}
                                className="group inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-3 py-1.5 text-sm text-slate-200 ring-1 ring-white/10"
                            >
                                {tag}
                                <button
                                    onClick={() => removeTag(tag)}
                                    className="ml-1 rounded p-0.5 opacity-60 active:bg-white/10 active:opacity-100"
                                >
                                    <X size={12} />
                                </button>
                            </span>
                        ))}
                    </div>
                </div>
            ) : null,
            attribution: (
                <div className="rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 shadow-lg shadow-black/20">
                    <div className="flex items-center gap-2 mb-3">
                        <TrendingUp size={18} className="text-indigo-200" />
                        <h2 className="font-black text-white">Attribution</h2>
                    </div>
                    {attribution ? (
                        <div className="space-y-3">
                            <div className="flex flex-wrap gap-2">
                                <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/15 px-2.5 py-1 text-xs font-bold text-sky-100 ring-1 ring-sky-300/20">
                                    First: {attribution.firstTouchSource}
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-bold text-emerald-100 ring-1 ring-emerald-300/20">
                                    Last: {attribution.lastTouchSource}
                                </span>
                            </div>

                            {(attribution.utmSource || attribution.utmMedium || attribution.utmCampaign) && (
                                <div className="space-y-1 border-t border-white/10 pt-2 text-xs text-slate-400">
                                    {attribution.utmSource && <div>Source: <span className="text-slate-100">{attribution.utmSource}</span></div>}
                                    {attribution.utmMedium && <div>Medium: <span className="text-slate-100">{attribution.utmMedium}</span></div>}
                                    {attribution.utmCampaign && <div>Campaign: <span className="text-slate-100">{attribution.utmCampaign}</span></div>}
                                </div>
                            )}

                            {(attribution.deviceType || attribution.country) && (
                                <div className="flex flex-wrap gap-2 border-t border-white/10 pt-2">
                                    {attribution.deviceType && (
                                        <span className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] px-2 py-1 text-xs text-slate-200">
                                            {attribution.deviceType === 'mobile' ? <Smartphone size={12} /> :
                                                attribution.deviceType === 'tablet' ? <Tablet size={12} /> : <Monitor size={12} />}
                                            {attribution.deviceType}
                                        </span>
                                    )}
                                    {attribution.country && (
                                        <span className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] px-2 py-1 text-xs text-slate-200">
                                            <Globe size={12} />
                                            {attribution.city ? `${attribution.city}, ` : ''}{attribution.country}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm italic text-slate-500">No attribution data</p>
                    )}
                </div>
            )
        };
    const visiblePanelOrder = mobilePanelOrder.filter((panelId) => mobilePanels[panelId]);

    return (
        <div className="space-y-4 pb-28">
            <div className="rounded-[2rem] border border-white/10 bg-slate-950 px-4 py-5 shadow-2xl shadow-black/30">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <button onClick={() => navigate('/m/orders')} className="rounded-2xl bg-white/10 p-3 text-slate-200 active:scale-95" aria-label="Back to orders"><ArrowLeft size={20} /></button>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${statusConfig.bg} ${statusConfig.color} ring-1 ${statusConfig.ring}`}><StatusIcon size={13} />{statusConfig.text}</span>
                </div>
                <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-400/10 px-2.5 py-1 text-xs font-semibold text-indigo-100 ring-1 ring-indigo-300/20"><Sparkles size={12} /> Order command</p>
                <h1 className="text-3xl font-black tracking-tight text-white">{order.orderNumber}</h1>
                <p className="mt-1 text-sm text-slate-400">{formatDate(order.createdAt)} · {order.customer.name}</p>
                <div className="mt-5 grid grid-cols-3 gap-2">
                    <div className="rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10"><p className="text-xl font-black text-white">{formatCurrency(order.total)}</p><p className="text-[11px] font-medium text-slate-400">Total</p></div>
                    <div className="rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10"><p className="text-xl font-black text-white">{order.lineItems.length}</p><p className="text-[11px] font-medium text-slate-400">Items</p></div>
                    <div className="rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10"><p className="text-xl font-black text-white">{order.trackingItems.length}</p><p className="text-[11px] font-medium text-slate-400">Tracking</p></div>
                </div>
            </div>

            <div className="sticky top-2 z-10 grid grid-cols-3 gap-2 rounded-3xl border border-white/10 bg-slate-950/90 p-2 shadow-xl shadow-black/20 backdrop-blur-xl">
                {order.customer.email && <a href={`mailto:${order.customer.email}`} className="rounded-2xl bg-white px-3 py-3 text-center text-xs font-black text-slate-950 active:scale-95"><Mail size={15} className="mx-auto mb-1" />Email</a>}
                {order.trackingItems[0]?.trackingUrl && <a href={getSafeHref(order.trackingItems[0].trackingUrl)} target="_blank" rel="noopener noreferrer" className="rounded-2xl bg-slate-800 px-3 py-3 text-center text-xs font-black text-white active:scale-95"><Truck size={15} className="mx-auto mb-1" />Track</a>}
                {order.trackingItems[0]?.trackingNumber && <button onClick={() => copyToClipboard(order.trackingItems[0].trackingNumber)} className="rounded-2xl bg-slate-800 px-3 py-3 text-center text-xs font-black text-white active:scale-95"><Copy size={15} className="mx-auto mb-1" />Copy</button>}
                <button onClick={generateInvoice} disabled={isGeneratingInvoice} className="rounded-2xl bg-slate-800 px-3 py-3 text-center text-xs font-black text-white disabled:opacity-50 active:scale-95"><FileText size={15} className="mx-auto mb-1" />{isGeneratingInvoice ? 'Wait' : 'Invoice'}</button>
            </div>

            <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950 shadow-lg shadow-black/20">
                <h2 className="border-b border-white/10 p-4 font-black text-white">Items ({order.lineItems.length})</h2>
                <div className="divide-y divide-white/10">
                    {order.lineItems.map((item) => (
                        <div key={item.id} className="p-4">
                            <div className="flex items-start gap-3">
                                {item.image ? (
                                    <img src={item.image} alt={item.name} className="h-16 w-16 flex-shrink-0 rounded-2xl object-cover ring-1 ring-white/10" />
                                ) : (
                                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10">
                                        <Package size={20} className="text-slate-500" />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-white">{item.name}</p>
                                    <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                                        <span>Qty: {item.quantity}</span>
                                        {item.sku && <span>SKU: {item.sku}</span>}
                                    </div>
                                </div>
                                <span className="font-black text-white">{formatCurrency(item.price)}</span>
                            </div>
                            {/* Product Variations / Metadata */}
                            {item.meta_data && item.meta_data.length > 0 && (
                                <div className="ml-[76px] mt-3 space-y-1.5">
                                    {item.meta_data
                                        .filter((meta) => !meta.key.startsWith('_'))
                                        .map((meta, idx) => {
                                            const imageUrls = extractAllImageUrls(meta.value);
                                            return (
                                                <div key={idx} className="text-xs">
                                                    <span className="rounded bg-white/[0.08] px-1.5 py-0.5 font-bold text-slate-400">
                                                        {fixMojibake(meta.key)}:
                                                    </span>
                                                    {imageUrls.length > 0 ? (
                                                        <div className="flex flex-wrap gap-2 mt-1">
                                                            {imageUrls.map((imgUrl, imgIdx) => (
                                                                <button
                                                                    key={imgIdx}
                                                                    onClick={() => setSelectedImage(imgUrl)}
                                                                    className="inline-block"
                                                                >
                                                                    <img
                                                                        src={imgUrl}
                                                                        alt={`${meta.key} ${imgIdx + 1}`}
                                                                        className="h-12 w-auto rounded-lg border border-white/10"
                                                                    />
                                                                </button>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span className="ml-1 whitespace-pre-line text-slate-300">{normalizeMetaValue(fixMojibake(meta.value))}</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 shadow-lg shadow-black/20">
                <h2 className="mb-3 font-black text-white">Order Summary</h2>
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="text-slate-200">{formatCurrency(order.subtotal)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Shipping</span><span className="text-slate-200">{formatCurrency(order.shippingTotal)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Tax</span><span className="text-slate-200">{formatCurrency(order.taxTotal)}</span></div>
                    <div className="flex justify-between border-t border-white/10 pt-3"><span className="font-black text-white">Total</span><span className="font-black text-white">{formatCurrency(order.total)}</span></div>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3"><CreditCard size={16} className="text-slate-500" /><span className="text-sm text-slate-400">{order.paymentMethod}</span></div>
            </div>

            <div className="rounded-[1.5rem] border border-white/10 bg-slate-950 p-3 shadow-lg shadow-black/20">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Reorder detail panels</span>
                    <button
                        onClick={() => {
                            setMobilePanelOrder(DEFAULT_MOBILE_PANEL_ORDER);
                            toast.success('Panel order reset');
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 active:bg-white/10"
                    >
                        <RotateCcw size={12} />
                        Reset
                    </button>
                </div>
            </div>

            {visiblePanelOrder.map((panelId, index) => (
                <div key={panelId}>
                    <div className="mb-2 flex justify-end gap-2">
                        <button
                            onClick={() => movePanel(panelId, 'up')}
                            disabled={index === 0}
                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <ChevronUp size={12} />
                            Up
                        </button>
                        <button
                            onClick={() => movePanel(panelId, 'down')}
                            disabled={index === visiblePanelOrder.length - 1}
                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <ChevronDown size={12} />
                            Down
                        </button>
                    </div>
                    {mobilePanels[panelId]}
                </div>
            ))}

            {/* Image Preview Modal */}
            {selectedImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
                    onClick={() => setSelectedImage(null)}
                >
                    <button
                        className="absolute top-4 right-4 p-2 bg-white/10 rounded-full"
                        onClick={() => setSelectedImage(null)}
                    >
                        <X size={24} className="text-white" />
                    </button>
                    <img
                        src={selectedImage}
                        alt="Preview"
                        className="max-w-full max-h-[85vh] object-contain rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
}

/**
 * Extracts ALL image URLs from a meta value.
 * WooCommerce can store multiple images per meta entry (newline or pipe separated).
 * Returns an array of all found image URLs.
 */
const extractAllImageUrls = (value: string): string[] => {
    if (typeof value !== 'string') return [];

    const imagePattern = /\.(jpg|jpeg|png|gif|webp|svg|bmp)/i;
    const urls: string[] = [];

    // Find all URLs in the value
    const urlMatches = value.match(/(https?:\/\/[^\s|,\n]+)/g);
    if (urlMatches) {
        for (const url of urlMatches) {
            const cleanUrl = url.trim();
            if (imagePattern.test(cleanUrl) && !urls.includes(cleanUrl)) {
                urls.push(cleanUrl);
            }
        }
    }

    return urls;
};

const normalizeMetaValue = (value: string): string => value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n');
