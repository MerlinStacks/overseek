import { useParams, Link } from 'react-router-dom';
import { Logger } from '../utils/logger';
import { useEffect, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { usePermissions } from '../hooks/usePermissions';
import { useAccountFeature } from '../hooks/useAccountFeature';
import { formatDate, formatCurrency } from '../utils/format';
import { User, MapPin, Mail, Phone, Package, RefreshCw, Printer, TrendingUp, Globe, Smartphone, Monitor, Tablet, Truck, ExternalLink, Copy, GripVertical } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { HistoryTimeline } from '../components/shared/HistoryTimeline';
import { Clock } from 'lucide-react';
import { FraudBadge } from '../components/orders/FraudBadge';
import { OrderTagPanel } from '../components/orders/OrderTagPanel';
import { OrderMetaSection } from '../components/orders/OrderMetaSection';
import { OrderCOGSPanel } from '../components/orders/OrderCOGSPanel';
import { OrderDetailPageSkeleton } from '../components/ui/PageSkeletons';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { useToast } from '../context/ToastContext';
import { openSafeUrl } from '../utils/url';
import { emitCrossTabEvent, subscribeToCrossTabEvents } from '../utils/productCrossTabEvents';
import { ShipmentMonitoringPanel } from '../components/shipping/ShipmentMonitoringPanel';
import { InvoiceGenerationIssueModal } from '../components/invoicing/InvoiceGenerationIssueModal';
import { generateCanonicalInvoice, InvoiceGenerationError } from '../utils/invoiceGeneration';
import type { InvoiceGenerationIssue } from '../utils/invoiceGeneration';

interface Attribution {
    firstTouchSource: string;
    lastTouchSource: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    referrer?: string;
    country?: string;
    city?: string;
    deviceType?: string;
    browser?: string;
    os?: string;
}

interface OrderLineItem {
    id: string | number;
    name: string;
    sku?: string | null;
    meta_data?: unknown[];
    price: number | string;
    quantity: number;
    total: number | string;
}

interface TrackingItem {
    provider?: string;
    dateShipped?: string;
    trackingNumber: string;
    trackingUrl?: string;
}

interface WooOrderStatusesResponse {
    data?: Array<{ slug?: string; name?: string }> | Record<string, { slug?: string; name?: string }>;
}

interface OrderDetails {
    id?: string | number;
    wooId?: number;
    status?: string;
    date_created?: string;
    payment_method_title?: string;
    currency?: string;
    total?: number | string;
    total_tax?: number | string;
    shipping_total?: number | string;
    line_items?: OrderLineItem[];
    shipping_lines?: Array<{ method_title?: string }>;
    billing?: Record<string, string>;
    shipping?: Record<string, string>;
    customer_id?: number;
    _customerMeta?: { ordersCount?: number };
    _count?: { messages?: number };
    tags?: string[];
    internal_updated_at?: string;
    tracking_items?: TrackingItem[];
    [key: string]: unknown;
}

type SidebarPanelId = 'tags' | 'cogs' | 'customer' | 'addresses' | 'tracking' | 'attribution';

const DEFAULT_SIDEBAR_PANEL_ORDER: SidebarPanelId[] = ['tags', 'cogs', 'customer', 'addresses', 'tracking', 'attribution'];

export function OrderDetailPage() {
    const { id } = useParams();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { hasPermission } = usePermissions();
    const isShippingHubEnabled = useAccountFeature('SHIPPING_HUB');
    const toast = useToast();

    const [order, setOrder] = useState<OrderDetails | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [showRaw, setShowRaw] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [invoiceIssue, setInvoiceIssue] = useState<InvoiceGenerationIssue | null>(null);
    const [invoiceCooldownSeconds, setInvoiceCooldownSeconds] = useState(0);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [attribution, setAttribution] = useState<Attribution | null>(null);
    const [sidebarPanelOrder, setSidebarPanelOrder] = useState<SidebarPanelId[]>(DEFAULT_SIDEBAR_PANEL_ORDER);
    const [draggedPanelId, setDraggedPanelId] = useState<SidebarPanelId | null>(null);
    const [dragOverPanelId, setDragOverPanelId] = useState<SidebarPanelId | null>(null);
    const [draggedPanelHeight, setDraggedPanelHeight] = useState<number>(0);
    const [isReorderMode, setIsReorderMode] = useState(false);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [statusToApply, setStatusToApply] = useState('');
    const [orderStatusOptions, setOrderStatusOptions] = useState<string[]>([]);
    const panelRefs = useRef<Partial<Record<SidebarPanelId, HTMLDivElement | null>>>({});

    useEffect(() => {
        if (invoiceCooldownSeconds <= 0) return;
        const timer = window.setInterval(() => {
            setInvoiceCooldownSeconds((seconds) => Math.max(0, seconds - 1));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [invoiceCooldownSeconds]);



    const fetchAttribution = useCallback(async () => {
        try {
            const res = await fetch(`/api/orders/${id}/attribution`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount?.id || ''
                }
            });
            if (res.ok) {
                const data = await res.json();
                setAttribution(data.attribution);
            }
        } catch {
            // Attribution is optional, don't fail the page
            Logger.warn('Could not load attribution data');
        }
    }, [id, token, currentAccount?.id]);

    const fetchOrder = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/orders/${id}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount?.id || ''
                }
            });
            if (!res.ok) throw new Error('Failed to fetch order');
            const data: OrderDetails = await res.json();
            setOrder(data);

            // Fetch attribution data
            fetchAttribution();
        } catch (err) {
            setError('Could not load order details.');
        } finally {
            setIsLoading(false);
        }
    }, [id, token, currentAccount?.id, fetchAttribution]);

    useEffect(() => {
        if (id && currentAccount && token) {
            fetchOrder();
        }
    }, [id, currentAccount, token, fetchOrder]);

    useEffect(() => {
        const storageKey = `order-detail-sidebar-order:${currentAccount?.id || 'default'}`;
        const saved = localStorage.getItem(storageKey);

        if (!saved) {
            setSidebarPanelOrder(DEFAULT_SIDEBAR_PANEL_ORDER);
            return;
        }

        try {
            const parsed = JSON.parse(saved);
            if (!Array.isArray(parsed)) {
                setSidebarPanelOrder(DEFAULT_SIDEBAR_PANEL_ORDER);
                return;
            }

            const validOrder = parsed.filter((panelId): panelId is SidebarPanelId =>
                typeof panelId === 'string' && DEFAULT_SIDEBAR_PANEL_ORDER.includes(panelId as SidebarPanelId)
            );

            const missingPanels = DEFAULT_SIDEBAR_PANEL_ORDER.filter((panelId) => !validOrder.includes(panelId));
            setSidebarPanelOrder([...validOrder, ...missingPanels]);
        } catch {
            setSidebarPanelOrder(DEFAULT_SIDEBAR_PANEL_ORDER);
        }
    }, [currentAccount?.id]);

    useEffect(() => {
        const storageKey = `order-detail-sidebar-order:${currentAccount?.id || 'default'}`;
        localStorage.setItem(storageKey, JSON.stringify(sidebarPanelOrder));
    }, [currentAccount?.id, sidebarPanelOrder]);

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
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void fetchOrder();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [fetchOrder]);



    const toNumber = (value: unknown): number => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    const toStringValue = (value: unknown): string => (typeof value === 'string' || typeof value === 'number') ? String(value) : '';
    const toMetaData = (value: unknown[]): Array<{ key: string; value: string; display_key?: string; display_value?: string }> =>
        value.filter((entry): entry is { key: string; value: string; display_key?: string; display_value?: string } => (
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as { key?: unknown }).key === 'string' &&
            typeof (entry as { value?: unknown }).value === 'string'
        ));

    const handleGenerateInvoice = async (regenerateAttempt = false) => {
        if (!order || !token || !currentAccount?.id) return;
        setIsGenerating(true);
        try {
            const orderId = Number(order.id || order.wooId);
            if (!Number.isFinite(orderId)) throw new Error('Invalid order ID');

            const { downloadUrl } = await generateCanonicalInvoice({
                orderId,
                token,
                accountId: currentAccount.id,
                forceRegenerate: true,
                regenerateAttempt,
            });
            if (!openSafeUrl(downloadUrl)) throw new Error('Invalid canonical invoice download URL');
            setInvoiceIssue(null);
            setInvoiceCooldownSeconds(0);

        } catch (e: unknown) {
            if (e instanceof InvoiceGenerationError && (e.issue.statusCode === 409 || e.issue.statusCode === 429)) {
                setInvoiceIssue(e.issue);
                setInvoiceCooldownSeconds(e.issue.retryAfterSeconds || (e.issue.statusCode === 429 ? 45 : 0));
                return;
            }
            const msg = e instanceof Error ? e.message : String(e);
            Logger.error('Invoice generation error', { error: msg });
            toast.error(`Failed to generate invoice: ${msg}`);
        } finally {
            setIsGenerating(false);
        }
    };

    const normalizeStatusSlug = useCallback((status: string) => status.replace(/^wc-/, '').toLowerCase(), []);
    const formatStatusLabel = (status: string) => status
        .split('-')
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ');

    const shouldExcludeStatus = useCallback((status: string) => {
        const normalized = normalizeStatusSlug(status);
        return normalized.includes('cancel') || normalized.includes('refund');
    }, [normalizeStatusSlug]);

    const loadOrderStatuses = useCallback(async () => {
        if (!token || !currentAccount?.id) return;

        try {
            const res = await fetch('/api/woocommerce/order-statuses', {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                }
            });

            if (!res.ok) {
                throw new Error('Failed to fetch order statuses');
            }

            const data = await res.json() as WooOrderStatusesResponse;
            const source = data.data;
            const rawStatuses = Array.isArray(source)
                ? source.map((item) => item.slug).filter((status): status is string => Boolean(status))
                : Object.keys(source || {}).filter(Boolean);

            const normalized = Array.from(new Set(rawStatuses.map(normalizeStatusSlug)))
                .filter((status) => !shouldExcludeStatus(status))
                .sort((a, b) => a.localeCompare(b));

            setOrderStatusOptions(normalized);
        } catch (err) {
            Logger.error('Failed to load WooCommerce order statuses', { error: err });
            setOrderStatusOptions(['pending', 'processing', 'on-hold', 'completed', 'failed']);
        }
    }, [currentAccount?.id, normalizeStatusSlug, shouldExcludeStatus, token]);

    useEffect(() => {
        if (currentAccount?.id && token) {
            void loadOrderStatuses();
        }
    }, [currentAccount?.id, loadOrderStatuses, token]);

    const handleUpdateOrderStatus = useCallback(async (nextStatus: string) => {
        if (!order || !currentAccount?.id || !token) return;

        const wooOrderId = Number(order.id || order.wooId);
        if (!Number.isFinite(wooOrderId)) {
            toast.error('Unable to update status for this order.');
            return;
        }

        setIsUpdatingStatus(true);
        try {
            const res = await fetch('/api/orders/bulk-status', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ orderIds: [wooOrderId], status: nextStatus })
            });

            if (!res.ok) {
                const body = await res.json().catch(() => null) as { error?: string } | null;
                throw new Error(body?.error || 'Failed to update order status');
            }

            setOrder((prev) => prev ? { ...prev, status: nextStatus } : prev);
            setStatusToApply('');
            toast.success(`Order status updated to ${formatStatusLabel(nextStatus)}.`);

            emitCrossTabEvent({
                resource: 'order',
                type: 'status-updated',
                accountId: currentAccount.id,
                resourceId: toStringValue(order.id || order.wooId || id || ''),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to update order status';
            Logger.error('Order status update failed', { error: message });
            toast.error(message);
        } finally {
            setIsUpdatingStatus(false);
        }
    }, [currentAccount?.id, id, order, token, toast]);

    /** Callback when tags are updated via the OrderTagPanel */
    function handleTagsChange(newTags: string[]) {
        setOrder((prev) => prev ? { ...prev, tags: newTags } : prev);
    }

    const movePanel = useCallback((draggedId: SidebarPanelId, targetId: SidebarPanelId) => {
        if (draggedId === targetId) return;

        setSidebarPanelOrder((prev) => {
            const fromIndex = prev.indexOf(draggedId);
            const toIndex = prev.indexOf(targetId);
            if (fromIndex === -1 || toIndex === -1) return prev;

            const next = [...prev];
            next.splice(fromIndex, 1);
            next.splice(toIndex, 0, draggedId);
            return next;
        });
    }, []);



    // ... existing useEffect ...

    if (!hasPermission('view_orders') && !isLoading) {
        return <div className="p-10 text-center text-red-500">Access Denied</div>;
    }

    if (isLoading) return <OrderDetailPageSkeleton />;
    if (error || !order) return <div className="p-10 text-center text-red-500">{error || 'Order not found'}</div>;

    const billing = order.billing || {};
    const shipping = order.shipping || {};
    const hasTrackingItems = (order.tracking_items || []).length > 0;
    const legacyTrackingPanel = hasTrackingItems ? (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5 space-y-4">
            <div className="font-semibold text-gray-900 flex items-center gap-2 border-b border-gray-100 pb-3">
                <Truck size={18} className="text-blue-500" />
                Shipment Tracking
            </div>

            <div className="space-y-3">
                {(order.tracking_items || []).map((item, idx: number) => (
                    <div key={idx} className={`space-y-2 ${idx > 0 ? 'pt-3 border-t border-dashed border-gray-200' : ''}`}>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase">{item.provider}</span>
                            {item.dateShipped && (
                                <span className="text-xs text-gray-400">
                                    • Shipped {formatDate(item.dateShipped)}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <code className="text-sm font-mono text-gray-900 bg-gray-50 px-2 py-1 rounded flex-1 truncate">
                                {item.trackingNumber}
                            </code>
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(item.trackingNumber);
                                }}
                                className="p-1.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600 transition-colors"
                                title="Copy tracking number"
                            >
                                <Copy size={14} />
                            </button>
                            {item.trackingUrl && (
                                <a
                                    href={item.trackingUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 hover:bg-blue-50 rounded text-blue-500 hover:text-blue-700 transition-colors"
                                    title="Track shipment"
                                >
                                    <ExternalLink size={14} />
                                </a>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    ) : null;

    const shippingWooOrderId = Number(order.wooId);

    const sidebarPanels: Record<SidebarPanelId, ReactNode | null> = {
            tags: (
                <OrderTagPanel
                    orderId={toStringValue(order.id || order.wooId || id || '')}
                    currentTags={order.tags || []}
                    lastUpdate={order.internal_updated_at}
                    onTagsChange={handleTagsChange}
                    onRefresh={fetchOrder}
                />
            ),
            cogs: <OrderCOGSPanel orderId={toStringValue(order.id || order.wooId || id || '')} currency={order.currency} />,
            customer: (
                <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5 space-y-4">
                    <div className="font-semibold text-gray-900 flex items-center gap-2 border-b border-gray-100 pb-3">
                        <User size={18} className="text-blue-500" />
                        Customer Details
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-gray-100 rounded-full text-gray-500"><User size={14} /></div>
                            <div>
                                {order.customer_id && order.customer_id > 0 ? (
                                    <Link
                                        to={`/customers/${order.customer_id}`}
                                        className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                                    >
                                        {billing.first_name} {billing.last_name}
                                    </Link>
                                ) : (
                                    <div className="text-sm font-medium text-gray-900">{billing.first_name} {billing.last_name}</div>
                                )}
                                <div className="text-xs text-gray-500">
                                    {order._customerMeta?.ordersCount !== undefined
                                        ? `${order._customerMeta.ordersCount} order${order._customerMeta.ordersCount !== 1 ? 's' : ''} previously`
                                        : 'Guest Customer'}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-gray-100 rounded-full text-gray-500"><Mail size={14} /></div>
                            <div>
                                <div className="text-sm font-medium text-gray-900 break-all">{billing.email}</div>
                                <div className="text-xs text-gray-500">Email</div>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-gray-100 rounded-full text-gray-500"><Phone size={14} /></div>
                            <div>
                                <div className="text-sm font-medium text-gray-900">{billing.phone || 'No phone'}</div>
                                <div className="text-xs text-gray-500">Phone</div>
                            </div>
                        </div>
                    </div>
                </div>
            ),
            addresses: (
                <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5 space-y-4">
                    <div className="font-semibold text-gray-900 flex items-center gap-2 border-b border-gray-100 pb-3">
                        <MapPin size={18} className="text-blue-500" />
                        Addresses
                    </div>

                    <div className="space-y-4">
                        <div>
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Billing</div>
                            <div className="text-sm text-gray-700 leading-relaxed">
                                {billing.address_1}<br />
                                {billing.address_2 && <>{billing.address_2}<br /></>}
                                {billing.city}, {billing.state} {billing.postcode}<br />
                                {billing.country}
                            </div>
                        </div>

                        {shipping && (
                            <div>
                                <div className="text-xs font-semibold text-gray-500 uppercase mb-1 pt-3 border-t border-dashed border-gray-200">Shipping</div>
                                <div className="text-sm text-gray-700 leading-relaxed">
                                    {shipping.address_1}<br />
                                    {shipping.address_2 && <>{shipping.address_2}<br /></>}
                                    {shipping.city}, {shipping.state} {shipping.postcode}<br />
                                    {shipping.country}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ),
            tracking: isShippingHubEnabled && Number.isFinite(shippingWooOrderId) && shippingWooOrderId > 0
                ? <ShipmentMonitoringPanel wooOrderId={shippingWooOrderId} fallback={legacyTrackingPanel} />
                : legacyTrackingPanel,
            attribution: (
                <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5 space-y-4">
                    <div className="font-semibold text-gray-900 flex items-center gap-2 border-b border-gray-100 pb-3">
                        <TrendingUp size={18} className="text-blue-500" />
                        Attribution
                    </div>

                    {attribution ? (
                        <div className="space-y-3">
                            <div>
                                <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Traffic Source</div>
                                <div className="flex flex-wrap gap-2">
                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                        First: {attribution.firstTouchSource}
                                    </span>
                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                        Last: {attribution.lastTouchSource}
                                    </span>
                                </div>
                            </div>

                            {(attribution.utmSource || attribution.utmMedium || attribution.utmCampaign) && (
                                <div>
                                    <div className="text-xs font-semibold text-gray-500 uppercase mb-1 pt-2 border-t border-dashed border-gray-200">UTM Parameters</div>
                                    <div className="space-y-1 text-sm">
                                        {attribution.utmSource && (
                                            <div className="flex gap-2">
                                                <span className="text-gray-500">Source:</span>
                                                <span className="text-gray-900">{attribution.utmSource}</span>
                                            </div>
                                        )}
                                        {attribution.utmMedium && (
                                            <div className="flex gap-2">
                                                <span className="text-gray-500">Medium:</span>
                                                <span className="text-gray-900">{attribution.utmMedium}</span>
                                            </div>
                                        )}
                                        {attribution.utmCampaign && (
                                            <div className="flex gap-2">
                                                <span className="text-gray-500">Campaign:</span>
                                                <span className="text-gray-900">{attribution.utmCampaign}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {(attribution.deviceType || attribution.country) && (
                                <div>
                                    <div className="text-xs font-semibold text-gray-500 uppercase mb-1 pt-2 border-t border-dashed border-gray-200">Device & Location</div>
                                    <div className="flex flex-wrap gap-2">
                                        {attribution.deviceType && (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-gray-100 text-gray-700">
                                                {attribution.deviceType === 'mobile' ? <Smartphone size={12} /> :
                                                    attribution.deviceType === 'tablet' ? <Tablet size={12} /> : <Monitor size={12} />}
                                                {attribution.deviceType}
                                            </span>
                                        )}
                                        {attribution.country && (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-gray-100 text-gray-700">
                                                <Globe size={12} />
                                                {attribution.city ? `${attribution.city}, ` : ''}{attribution.country}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-sm text-gray-500 italic">No attribution data available</div>
                    )}
                </div>
            )
        };

    const visiblePanelOrder = sidebarPanelOrder.filter((panelId) => sidebarPanels[panelId]);

    return (
        <div className="max-w-6xl mx-auto space-y-6 pb-20">
            {/* Header / Nav */}
            <Breadcrumbs items={[
                { label: 'Orders', href: '/orders' },
                { label: `#${order.id}` }
            ]} />
            <div className="flex items-center gap-4 mb-6">
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold text-gray-900">Order #{order.id}</h1>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide
              ${order.status === 'completed' ? 'bg-green-100 text-green-700' :
                                order.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                                    order.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                            {order.status}
                        </span>
                        <FraudBadge orderId={id || ''} />
                    </div>
                    <div className="text-sm text-gray-500 mt-1">Placed on {formatDate(toStringValue(order.date_created))} via {order.payment_method_title}</div>
                </div>
                <div className="flex gap-2">
                    <select
                        value={statusToApply}
                        onChange={(event) => {
                            const nextStatus = event.target.value;
                            setStatusToApply(nextStatus);
                            if (nextStatus) {
                                void handleUpdateOrderStatus(nextStatus);
                            }
                        }}
                        disabled={isUpdatingStatus || orderStatusOptions.length === 0}
                        className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-60"
                    >
                        <option value="">{isUpdatingStatus ? 'Updating status...' : 'Change status...'}</option>
                        {orderStatusOptions.map((status) => (
                            <option key={status} value={status}>{formatStatusLabel(status)}</option>
                        ))}
                    </select>
                    <button
                        onClick={() => void handleGenerateInvoice()}
                        disabled={isGenerating}
                        className="btn-white flex items-center gap-2"
                    >
                        {isGenerating ? <div className="animate-spin text-gray-500"><RefreshCw size={16} /></div> : <Printer size={16} />}
                        Generate Invoice
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Main Content - Items */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50 font-semibold text-gray-800 flex items-center gap-2">
                            <Package size={18} className="text-gray-400" />
                            Order Items
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="text-xs text-gray-500 uppercase bg-gray-50/30 border-b border-gray-100">
                                    <tr>
                                        <th className="px-6 py-3 font-medium">Item</th>
                                        <th className="px-6 py-3 font-medium text-right">Cost</th>
                                        <th className="px-6 py-3 font-medium text-center">Qty</th>
                                        <th className="px-6 py-3 font-medium text-right">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {order.line_items?.map((item) => (
                                        <tr key={item.id} className="hover:bg-gray-50/50">
                                            <td className="px-6 py-4">
                                                <div className="font-medium text-gray-900">{item.name}</div>
                                                <div className="text-xs text-gray-500">SKU: {item.sku || 'N/A'}</div>
                                                {item.meta_data && item.meta_data.length > 0 && (
                                                    <OrderMetaSection metaData={toMetaData(item.meta_data)} onImageClick={setSelectedImage} />
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right text-gray-600">
                                                {formatCurrency(toNumber(item.price), order.currency)}
                                            </td>
                                            <td className="px-6 py-4 text-center text-gray-600 bg-gray-50/30">
                                                {item.quantity}
                                            </td>
                                            <td className="px-6 py-4 text-right font-medium text-gray-900">
                                                {formatCurrency(toNumber(item.total), order.currency)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-gray-50/50 border-t border-gray-100">
                                    <tr>
                                        <td colSpan={3} className="px-6 py-3 text-right text-sm text-gray-500">Subtotal</td>
                                        <td className="px-6 py-3 text-right font-medium text-gray-800">
                                            {formatCurrency(Number(order.total) - Number(order.total_tax) - Number(order.shipping_total), order.currency)}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td colSpan={3} className="px-6 py-2 text-right text-sm text-gray-500">
                                            Shipping
                                            {order.shipping_lines?.[0]?.method_title && (
                                                <span className="ml-1 text-xs text-gray-400">
                                                    ({order.shipping_lines[0].method_title})
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-2 text-right font-medium text-gray-800">
                                            {formatCurrency(toNumber(order.shipping_total), order.currency)}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td colSpan={3} className="px-6 py-2 text-right text-sm text-gray-500">Tax</td>
                                        <td className="px-6 py-2 text-right font-medium text-gray-800">
                                            {formatCurrency(toNumber(order.total_tax), order.currency)}
                                        </td>
                                    </tr>
                                    <tr className="border-t border-gray-200 bg-gray-100">
                                        <td colSpan={3} className="px-6 py-4 text-right font-bold text-gray-900 text-lg">Total</td>
                                        <td className="px-6 py-4 text-right font-bold text-blue-600 text-lg">
                                            {formatCurrency(toNumber(order.total), order.currency)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* Raw Data Toggle */}
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <button
                            onClick={() => setShowRaw(!showRaw)}
                            className="w-full px-4 py-2 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase hover:bg-gray-100 transition-colors flex justify-between items-center"
                        >
                            <span>Raw Data (Debug)</span>
                            <span>{showRaw ? 'Hide' : 'Show'}</span>
                        </button>
                        {showRaw && (
                            <pre className="p-4 bg-gray-900 text-green-400 text-xs overflow-auto max-h-96 custom-scrollbar">
                                {JSON.stringify(order, null, 2)}
                            </pre>
                        )}
                    </div>
                </div>

                {/* Sidebar - Customer Details */}
                <div className="space-y-6">
                    <div className="flex justify-end items-center gap-3">
                        <button
                            onClick={() => setIsReorderMode((prev) => !prev)}
                            className={`text-xs underline underline-offset-2 ${isReorderMode ? 'text-indigo-600 hover:text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            {isReorderMode ? 'Done reordering' : 'Reorder panels'}
                        </button>
                        <button
                            onClick={() => {
                                setSidebarPanelOrder(DEFAULT_SIDEBAR_PANEL_ORDER);
                                toast.success('Panel order reset');
                            }}
                            className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
                        >
                            Reset panel order
                        </button>
                    </div>
                    {visiblePanelOrder.map((panelId) => (
                        <div
                            key={panelId}
                            ref={(node) => {
                                panelRefs.current[panelId] = node;
                            }}
                            draggable={isReorderMode}
                            onDragStart={(event) => {
                                if (!isReorderMode) return;
                                setDraggedPanelId(panelId);
                                setDragOverPanelId(panelId);
                                setDraggedPanelHeight(event.currentTarget.getBoundingClientRect().height);
                            }}
                            onDragOver={(event) => {
                                if (!isReorderMode) return;
                                event.preventDefault();
                                if (dragOverPanelId !== panelId) {
                                    setDragOverPanelId(panelId);
                                }
                            }}
                            onDrop={() => {
                                if (!isReorderMode) return;
                                if (!draggedPanelId) return;
                                movePanel(draggedPanelId, panelId);
                                setDraggedPanelId(null);
                                setDragOverPanelId(null);
                                setDraggedPanelHeight(0);
                            }}
                            onDragEnd={() => {
                                setDraggedPanelId(null);
                                setDragOverPanelId(null);
                                setDraggedPanelHeight(0);
                            }}
                            className={draggedPanelId === panelId ? 'opacity-40' : ''}
                        >
                            {isReorderMode && draggedPanelId && dragOverPanelId === panelId && draggedPanelId !== panelId && (
                                <div
                                    className="mb-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/60 p-4"
                                    style={{ height: draggedPanelHeight || panelRefs.current[draggedPanelId]?.getBoundingClientRect().height || undefined }}
                                >
                                    <div className="h-3 w-32 animate-pulse rounded bg-indigo-200/70" />
                                    <div className="mt-3 h-2 w-full animate-pulse rounded bg-indigo-100" />
                                    <div className="mt-2 h-2 w-4/5 animate-pulse rounded bg-indigo-100" />
                                </div>
                            )}
                            <div className="relative">
                                {isReorderMode && (
                                    <div className="absolute right-3 top-3 z-10">
                                        <div className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white/95 px-2 py-1 text-xs text-gray-500 cursor-move shadow-sm">
                                            <GripVertical size={12} />
                                            Move
                                        </div>
                                    </div>
                                )}
                                {sidebarPanels[panelId]}
                            </div>
                        </div>
                    ))}
                </div>

            </div>

            {/* History Section */}
            <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Clock size={18} className="text-gray-400" />
                    <h2 className="text-lg font-medium text-gray-900">Order History</h2>
                </div>
                <HistoryTimeline resource="ORDER" resourceId={toStringValue(order.id || order.wooId)} />
            </div>

            {/* Image Preview Modal */}
            <Modal isOpen={!!selectedImage} onClose={() => setSelectedImage(null)} maxWidth="max-w-4xl" title="Image Preview">
                <div className="flex justify-center bg-gray-50 rounded-lg overflow-hidden">
                    <img src={selectedImage || ''} alt="Preview" className="max-w-full max-h-[80vh] object-contain" />
                </div>
            </Modal>
            <InvoiceGenerationIssueModal
                issue={invoiceIssue}
                isRegenerating={isGenerating}
                cooldownSeconds={invoiceCooldownSeconds}
                onClose={() => setInvoiceIssue(null)}
                onRegenerate={() => void handleGenerateInvoice(true)}
            />
        </div>
    );
}
