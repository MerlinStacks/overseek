import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, Truck, CheckCircle, XCircle, Clock, MapPin, User, Mail, Phone, CreditCard, Copy, ExternalLink, X, TrendingUp, Globe, Smartphone, Monitor, Tablet, Tag } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { fixMojibake, formatCurrency, formatDateTime } from '../../utils/format';

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
    trackingNumber?: string;
    trackingUrl?: string;
    currency?: string;
}

const STATUS_CONFIG: Record<string, { icon: typeof Package; color: string; bg: string; text: string }> = {
    pending: { icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-100', text: 'Pending' },
    processing: { icon: Package, color: 'text-blue-600', bg: 'bg-blue-100', text: 'Processing' },
    shipped: { icon: Truck, color: 'text-purple-600', bg: 'bg-purple-100', text: 'Shipped' },
    delivered: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100', text: 'Delivered' },
    completed: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100', text: 'Completed' },
    cancelled: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-100', text: 'Cancelled' },
};

export function MobileOrderDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [order, setOrder] = useState<OrderDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [attribution, setAttribution] = useState<Attribution | null>(null);
    const [orderTags, setOrderTags] = useState<string[]>([]);

    useEffect(() => {
        if (id) fetchOrder();
        // Listen for refresh events from pull-to-refresh
        const handleRefresh = () => { if (id) fetchOrder(); };
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [id, token, currentAccount]);

    const fetchOrder = async () => {
        if (!currentAccount || !token || !id) return;

        try {
            setLoading(true);
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
                trackingNumber: o.tracking_number,
                trackingUrl: o.tracking_url,
                currency: o.currency
            });

            // Store tags separately for removal functionality
            setOrderTags(o.tags || []);

            // Fetch attribution data
            fetchAttribution();
        } catch (error) {
            Logger.error('[MobileOrderDetail] Error:', { error: error });
        } finally {
            setLoading(false);
        }
    };

    const fetchAttribution = async () => {
        if (!currentAccount || !token || !id) return;
        try {
            const res = await fetch(`/api/orders/${id}/attribution`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (res.ok) {
                const data = await res.json();
                setAttribution(data.attribution);
            }
        } catch (err) {
            console.warn('Could not load attribution');
        }
    };

    const formatMoney = (amount: number) => formatCurrency(amount, currentAccount?.currency || 'USD');
    const formatDate = (date: string) => formatDateTime(date);
    const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); if ('vibrate' in navigator) navigator.vibrate(10); };

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
            }
        } catch (err) {
            Logger.error('Failed to remove tag', { error: err });
        }
    };

    if (loading) return <div className="space-y-4 animate-pulse"><div className="h-10 bg-gray-200 rounded w-1/3" /><div className="h-24 bg-gray-200 rounded-xl" /><div className="h-40 bg-gray-200 rounded-xl" /></div>;
    if (!order) return <div className="text-center py-12"><Package className="mx-auto text-gray-300 mb-4" size={48} /><p className="text-gray-500">Order not found</p><button onClick={() => navigate('/m/orders')} className="mt-4 text-indigo-600 font-medium">Back to Orders</button></div>;

    const statusConfig = STATUS_CONFIG[order.status.toLowerCase()] || STATUS_CONFIG.pending;
    const StatusIcon = statusConfig.icon;

    return (
        <div className="space-y-4 pb-8">
            <div className="flex items-center gap-3">
                <button onClick={() => navigate('/m/orders')} className="p-2 -ml-2 rounded-lg active:bg-gray-100"><ArrowLeft size={24} className="text-gray-700" /></button>
                <div className="flex-1"><h1 className="text-xl font-bold text-gray-900">{order.orderNumber}</h1><p className="text-sm text-gray-500">{formatDate(order.createdAt)}</p></div>
            </div>

            <div className={`${statusConfig.bg} rounded-xl p-4 flex items-center gap-4`}>
                <div className="p-3 bg-white rounded-lg shadow-sm"><StatusIcon size={24} className={statusConfig.color} /></div>
                <div className="flex-1">
                    <p className={`font-semibold ${statusConfig.color}`}>{statusConfig.text}</p>
                    {order.trackingNumber && <button onClick={() => copyToClipboard(order.trackingNumber!)} className="flex items-center gap-1 text-sm text-gray-600 mt-1"><span>Tracking: {order.trackingNumber}</span><Copy size={14} /></button>}
                </div>
                {order.trackingUrl && <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="p-2 bg-white rounded-lg shadow-sm"><ExternalLink size={20} className="text-gray-600" /></a>}
            </div>

            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <h2 className="font-semibold text-gray-900 mb-3">Customer</h2>
                <div className="space-y-3">
                    <div className="flex items-center gap-3"><User size={18} className="text-gray-400" /><span className="text-gray-700">{order.customer.name}</span></div>
                    {order.customer.email && <a href={`mailto:${order.customer.email}`} className="flex items-center gap-3"><Mail size={18} className="text-gray-400" /><span className="text-indigo-600">{order.customer.email}</span></a>}
                    {order.customer.phone && <a href={`tel:${order.customer.phone}`} className="flex items-center gap-3"><Phone size={18} className="text-gray-400" /><span className="text-indigo-600">{order.customer.phone}</span></a>}
                </div>
            </div>

            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <h2 className="font-semibold text-gray-900 mb-3">Shipping Address</h2>
                <div className="flex items-start gap-3"><MapPin size={18} className="text-gray-400 mt-0.5" /><div className="text-gray-700"><p>{order.shipping.address1}</p><p>{order.shipping.city}, {order.shipping.state} {order.shipping.postcode}</p><p>{order.shipping.country}</p></div></div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <h2 className="font-semibold text-gray-900 p-4 border-b border-gray-100">Items ({order.lineItems.length})</h2>
                <div className="divide-y divide-gray-100">
                    {order.lineItems.map((item) => (
                        <div key={item.id} className="p-4">
                            <div className="flex items-start gap-3">
                                {item.image ? (
                                    <img src={item.image} alt={item.name} className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                                ) : (
                                    <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                                        <Package size={20} className="text-gray-400" />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900">{item.name}</p>
                                    <div className="flex items-center gap-2 text-sm text-gray-500">
                                        <span>Qty: {item.quantity}</span>
                                        {item.sku && <span>• SKU: {item.sku}</span>}
                                    </div>
                                </div>
                                <span className="font-medium text-gray-900">{formatCurrency(item.price)}</span>
                            </div>
                            {/* Product Variations / Metadata */}
                            {item.meta_data && item.meta_data.length > 0 && (
                                <div className="mt-2 ml-[68px] space-y-1">
                                    {item.meta_data
                                        .filter((meta) => !meta.key.startsWith('_'))
                                        .map((meta, idx) => {
                                            const imageUrls = extractAllImageUrls(meta.value);
                                            return (
                                                <div key={idx} className="text-xs">
                                                    <span className="font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
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
                                                                        className="h-12 w-auto rounded border border-gray-200"
                                                                    />
                                                                </button>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span className="ml-1 text-gray-700 whitespace-pre-line">{fixMojibake(meta.value)}</span>
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

            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <h2 className="font-semibold text-gray-900 mb-3">Order Summary</h2>
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-600">Subtotal</span><span className="text-gray-900">{formatCurrency(order.subtotal)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Shipping</span><span className="text-gray-900">{formatCurrency(order.shippingTotal)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Tax</span><span className="text-gray-900">{formatCurrency(order.taxTotal)}</span></div>
                    <div className="flex justify-between pt-2 border-t border-gray-100"><span className="font-semibold text-gray-900">Total</span><span className="font-bold text-gray-900">{formatCurrency(order.total)}</span></div>
                </div>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100"><CreditCard size={16} className="text-gray-400" /><span className="text-sm text-gray-600">{order.paymentMethod}</span></div>
            </div>

            {/* Tags Section */}
            {orderTags.length > 0 && (
                <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                    <div className="flex items-center gap-2 mb-3">
                        <Tag size={18} className="text-indigo-600" />
                        <h2 className="font-semibold text-gray-900">Tags</h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {orderTags.map((tag) => (
                            <span
                                key={tag}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-sm bg-gray-100 text-gray-700 group"
                            >
                                {tag}
                                <button
                                    onClick={() => removeTag(tag)}
                                    className="ml-1 p-0.5 rounded active:bg-gray-200 opacity-60 active:opacity-100"
                                >
                                    <X size={12} />
                                </button>
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Attribution Section */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 mb-3">
                    <TrendingUp size={18} className="text-indigo-600" />
                    <h2 className="font-semibold text-gray-900">Attribution</h2>
                </div>
                {attribution ? (
                    <div className="space-y-3">
                        {/* Traffic Source */}
                        <div className="flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                First: {attribution.firstTouchSource}
                            </span>
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                Last: {attribution.lastTouchSource}
                            </span>
                        </div>

                        {/* UTM Parameters */}
                        {(attribution.utmSource || attribution.utmMedium || attribution.utmCampaign) && (
                            <div className="text-xs text-gray-600 space-y-1 pt-2 border-t border-gray-100">
                                {attribution.utmSource && <div>Source: <span className="text-gray-900">{attribution.utmSource}</span></div>}
                                {attribution.utmMedium && <div>Medium: <span className="text-gray-900">{attribution.utmMedium}</span></div>}
                                {attribution.utmCampaign && <div>Campaign: <span className="text-gray-900">{attribution.utmCampaign}</span></div>}
                            </div>
                        )}

                        {/* Device & Location */}
                        {(attribution.deviceType || attribution.country) && (
                            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
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
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-gray-500 italic">No attribution data</p>
                )}
            </div>

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
 * Extracts an image URL from a meta value.
 * Handles compound values like "filename.webp | https://example.com/path/to/image.webp"
 */
const extractImageUrl = (value: string): string | null => {
    if (typeof value !== 'string') return null;

    const imagePattern = /\.(jpg|jpeg|png|gif|webp|svg|bmp)/i;

    // Direct image URL
    if (imagePattern.test(value) && value.startsWith('http')) {
        return value;
    }

    // Look for URLs within the value (handles "filename | url" format)
    const urlMatch = value.match(/(https?:\/\/[^\s|]+)/g);
    if (urlMatch) {
        for (const url of urlMatch) {
            if (imagePattern.test(url)) {
                return url.trim();
            }
        }
    }

    return null;
};

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
