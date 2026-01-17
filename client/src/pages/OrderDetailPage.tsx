import { useParams, useNavigate, Link } from 'react-router-dom';
import { Logger } from '../utils/logger';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { usePermissions } from '../hooks/usePermissions';
import { formatDate } from '../utils/format';
import { ArrowLeft, User, MapPin, Mail, Phone, Package, CreditCard, RefreshCw, Printer, TrendingUp, Globe, Smartphone, Monitor, Tablet, Tag, X, ChevronDown, ChevronUp, Palette, FileText, Image as ImageIcon, Settings } from 'lucide-react';
import { generateInvoicePDF } from '../utils/InvoiceGenerator';
import { Modal } from '../components/ui/Modal';
import { HistoryTimeline } from '../components/shared/HistoryTimeline';
import { Clock } from 'lucide-react';
import { FraudBadge } from '../components/orders/FraudBadge';

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

export function OrderDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { hasPermission } = usePermissions();

    const [order, setOrder] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [showRaw, setShowRaw] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [attribution, setAttribution] = useState<Attribution | null>(null);



    useEffect(() => {
        if (id && currentAccount && token) {
            fetchOrder();
        }
    }, [id, currentAccount, token]);

    async function fetchOrder() {
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
            const data = await res.json();
            setOrder(data);

            // Fetch attribution data
            fetchAttribution();
        } catch (err) {
            setError('Could not load order details.');
        } finally {
            setIsLoading(false);
        }
    }

    async function fetchAttribution() {
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
        } catch (err) {
            // Attribution is optional, don't fail the page
            console.warn('Could not load attribution data');
        }
    }



    const handleGenerateInvoice = async () => {
        setIsGenerating(true);
        try {
            // 1. Fetch Templates
            const res = await fetch(`/api/invoices/templates`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount?.id || ''
                }
            });
            if (!res.ok) throw new Error("Failed to fetch templates");

            const templates = await res.json();

            // Use the most recent template or default
            const template = templates.length > 0 ? templates[0] : null;

            if (!template) {
                alert("No invoice template found. Please design one first.");
                return;
            }

            // 2. Generate PDF
            await generateInvoicePDF(order, template.layout?.grid || [], template.layout?.items || [], template.name);

        } catch (e) {
            Logger.error('An error occurred', { error: e });
            alert("Failed to generate invoice");
        } finally {
            setIsGenerating(false);
        }
    };

    async function removeTag(tag: string) {
        if (!currentAccount || !token || !order) return;
        try {
            const res = await fetch(`/api/orders/${order.id}/tags/${encodeURIComponent(tag)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setOrder((prev: any) => ({ ...prev, tags: data.tags }));
            }
        } catch (err) {
            Logger.error('Failed to remove tag', { error: err });
        }
    }



    // ... existing useEffect ...

    if (!hasPermission('view_orders') && !isLoading) {
        return <div className="p-10 text-center text-red-500">Access Denied</div>;
    }

    if (isLoading) return <div className="p-10 flex justify-center"><div className="animate-spin text-blue-600"><RefreshCw /></div></div>;
    if (error || !order) return <div className="p-10 text-center text-red-500">{error || 'Order not found'}</div>;

    const billing = order.billing || {};
    const shipping = order.shipping || {};

    return (
        <div className="max-w-6xl mx-auto space-y-6 pb-20">
            {/* Header / Nav */}
            <div className="flex items-center gap-4 mb-6">
                <button onClick={() => navigate('/orders')} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
                    <ArrowLeft size={20} />
                </button>
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
                    <div className="text-sm text-gray-500 mt-1">Placed on {formatDate(order.date_created)} via {order.payment_method_title}</div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleGenerateInvoice}
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
                                    {order.line_items?.map((item: any) => (
                                        <tr key={item.id} className="hover:bg-gray-50/50">
                                            <td className="px-6 py-4">
                                                <div className="font-medium text-gray-900">{item.name}</div>
                                                <div className="text-xs text-gray-500">SKU: {item.sku || 'N/A'}</div>
                                                {item.meta_data && item.meta_data.length > 0 && (
                                                    <OrderMetaSection metaData={item.meta_data} onImageClick={setSelectedImage} />
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right text-gray-600">
                                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency }).format(item.price)}
                                            </td>
                                            <td className="px-6 py-4 text-center text-gray-600 bg-gray-50/30">
                                                {item.quantity}
                                            </td>
                                            <td className="px-6 py-4 text-right font-medium text-gray-900">
                                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency }).format(item.total)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-gray-50/50 border-t border-gray-100">
                                    <tr>
                                        <td colSpan={3} className="px-6 py-3 text-right text-sm text-gray-500">Subtotal</td>
                                        <td className="px-6 py-3 text-right font-medium text-gray-800">
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency }).format(Number(order.total) - Number(order.total_tax) - Number(order.shipping_total))}
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
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency }).format(order.shipping_total)}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td colSpan={3} className="px-6 py-2 text-right text-sm text-gray-500">Tax</td>
                                        <td className="px-6 py-2 text-right font-medium text-gray-800">
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency }).format(order.total_tax)}
                                        </td>
                                    </tr>
                                    <tr className="border-t border-gray-200 bg-gray-100">
                                        <td colSpan={3} className="px-6 py-4 text-right font-bold text-gray-900 text-lg">Total</td>
                                        <td className="px-6 py-4 text-right font-bold text-blue-600 text-lg">
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency }).format(order.total)}
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
                    {/* Customer Card */}
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

                    {/* Address Card */}
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

                            {/* Only show Shipping if different/exists */}
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

                    {/* Tags Card */}
                    {order.tags && order.tags.length > 0 && (
                        <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5 space-y-4">
                            <div className="font-semibold text-gray-900 flex items-center gap-2 border-b border-gray-100 pb-3">
                                <Tag size={18} className="text-blue-500" />
                                Tags
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {order.tags.map((tag: string) => (
                                    <span
                                        key={tag}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-sm bg-gray-100 text-gray-700 group"
                                    >
                                        {tag}
                                        <button
                                            onClick={() => removeTag(tag)}
                                            className="ml-1 p-0.5 rounded hover:bg-gray-200 opacity-60 hover:opacity-100 transition-opacity"
                                            title="Remove tag"
                                        >
                                            <X size={12} />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Attribution Card */}
                    <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5 space-y-4">
                        <div className="font-semibold text-gray-900 flex items-center gap-2 border-b border-gray-100 pb-3">
                            <TrendingUp size={18} className="text-blue-500" />
                            Attribution
                        </div>

                        {attribution ? (
                            <div className="space-y-3">
                                {/* Traffic Source */}
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

                                {/* UTM Parameters */}
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

                                {/* Device & Location */}
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
                </div>

            </div>

            {/* History Section */}
            <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Clock size={18} className="text-gray-400" />
                    <h2 className="text-lg font-medium text-gray-900">Order History</h2>
                </div>
                <HistoryTimeline resource="ORDER" resourceId={order.id || order.wooId} />
            </div>

            {/* Image Preview Modal */}
            <Modal isOpen={!!selectedImage} onClose={() => setSelectedImage(null)} maxWidth="max-w-4xl" title="Image Preview">
                <div className="flex justify-center bg-gray-50 rounded-lg overflow-hidden">
                    <img src={selectedImage || ''} alt="Preview" className="max-w-full max-h-[80vh] object-contain" />
                </div>
            </Modal>
        </div>
    );
}

/**
 * Extracts an image URL from a meta value.
 * Handles compound values like "filename.webp | https://example.com/path/to/image.webp"
 * Returns the URL if found, null otherwise.
 */
const extractImageUrl = (value: string): string | null => {
    if (typeof value !== 'string') return null;

    // Common image extensions pattern
    const imagePattern = /\.(jpg|jpeg|png|gif|webp|svg|bmp)/i;

    // First, check if the value itself is a direct image URL
    if (imagePattern.test(value) && value.startsWith('http')) {
        return value;
    }

    // Look for URLs within the value (handles "filename | url" format)
    const urlMatch = value.match(/(https?:\/\/[^\s|]+)/g);
    if (urlMatch) {
        // Find the first URL that looks like an image
        for (const url of urlMatch) {
            if (imagePattern.test(url)) {
                return url.trim();
            }
        }
    }

    return null;
};

interface MetaCategory {
    id: string;
    label: string;
    icon: React.ReactNode;
    color: string;
    bgColor: string;
    items: Array<{ key: string; value: string; imageUrl?: string | null }>;
}

function OrderMetaSection({ metaData, onImageClick }: { metaData: any[], onImageClick: (url: string) => void }) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['variations']));

    // Filter out hidden meta and categorize
    const filteredMeta = metaData.filter(m => !m.key.startsWith('_'));

    if (filteredMeta.length === 0) return null;

    // Categorize metadata
    const categories: MetaCategory[] = [];

    // Variations/Attributes (pa_ prefix or common variation keys)
    const variations = filteredMeta.filter(m =>
        m.key.startsWith('pa_') ||
        ['size', 'color', 'colour', 'variant', 'style', 'material', 'weight'].some(k =>
            m.key.toLowerCase().includes(k)
        )
    );

    // Uploads/Images
    const uploads = filteredMeta.filter(m => {
        const url = extractImageUrl(m.value);
        return url !== null;
    });

    // Custom fields (everything else)
    const customFields = filteredMeta.filter(m =>
        !variations.includes(m) && !uploads.includes(m)
    );

    if (variations.length > 0) {
        categories.push({
            id: 'variations',
            label: 'Product Options',
            icon: <Palette size={12} />,
            color: 'text-purple-700',
            bgColor: 'bg-purple-50 border-purple-200',
            items: variations.map(m => ({
                key: m.display_key || m.key.replace('pa_', '').replace(/_/g, ' '),
                value: m.display_value || m.value,
                imageUrl: null
            }))
        });
    }

    if (customFields.length > 0) {
        categories.push({
            id: 'custom',
            label: 'Custom Fields',
            icon: <Settings size={12} />,
            color: 'text-blue-700',
            bgColor: 'bg-blue-50 border-blue-200',
            items: customFields.map(m => ({
                key: m.display_key || m.key.replace(/_/g, ' '),
                value: m.display_value || m.value,
                imageUrl: null
            }))
        });
    }

    if (uploads.length > 0) {
        categories.push({
            id: 'uploads',
            label: 'Uploaded Files',
            icon: <ImageIcon size={12} />,
            color: 'text-amber-700',
            bgColor: 'bg-amber-50 border-amber-200',
            items: uploads.map(m => ({
                key: m.display_key || m.key.replace(/_/g, ' '),
                value: m.display_value || m.value,
                imageUrl: extractImageUrl(m.value)
            }))
        });
    }

    const toggleCategory = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    return (
        <div className="mt-3 space-y-2">
            {categories.map(category => {
                const isExpanded = expandedCategories.has(category.id);

                return (
                    <div key={category.id} className={`rounded-lg border overflow-hidden ${category.bgColor}`}>
                        {/* Category Header */}
                        <button
                            onClick={() => toggleCategory(category.id)}
                            className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/30 transition-colors"
                        >
                            <div className={`flex items-center gap-2 text-xs font-semibold ${category.color}`}>
                                {category.icon}
                                <span className="capitalize">{category.label}</span>
                                <span className="px-1.5 py-0.5 rounded-full bg-white/60 text-[10px] font-bold">
                                    {category.items.length}
                                </span>
                            </div>
                            {isExpanded ? (
                                <ChevronUp size={14} className={category.color} />
                            ) : (
                                <ChevronDown size={14} className={category.color} />
                            )}
                        </button>

                        {/* Category Content */}
                        {isExpanded && (
                            <div className="px-3 pb-3 bg-white/40">
                                {category.id === 'uploads' ? (
                                    // Image Gallery View
                                    <div className="flex flex-wrap gap-2 pt-2">
                                        {category.items.map((item, idx) => (
                                            <ImageThumbnail
                                                key={idx}
                                                item={item}
                                                onImageClick={onImageClick}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    // Key-Value List View
                                    <div className="grid gap-1.5 pt-2">
                                        {category.items.map((item, idx) => (
                                            <div key={idx} className="flex items-baseline gap-2 text-xs">
                                                <span className="font-medium text-gray-600 capitalize min-w-[80px]">
                                                    {item.key}:
                                                </span>
                                                <span className="text-gray-900 break-all">
                                                    {item.value.startsWith('http') ? (
                                                        <a
                                                            href={item.value}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-blue-600 hover:underline"
                                                        >
                                                            {item.value.length > 40 ? item.value.slice(0, 40) + '...' : item.value}
                                                        </a>
                                                    ) : (
                                                        item.value
                                                    )}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function ImageThumbnail({ item, onImageClick }: { item: { key: string; value: string; imageUrl?: string | null }, onImageClick: (url: string) => void }) {
    const [imgError, setImgError] = useState(false);

    if (!item.imageUrl || imgError) {
        return (
            <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs text-gray-500">
                <FileText size={12} />
                <span>{item.key}</span>
            </div>
        );
    }

    return (
        <div className="group relative">
            <div
                className="cursor-zoom-in rounded-lg overflow-hidden border-2 border-transparent hover:border-purple-400 transition-all shadow-sm hover:shadow-md"
                onClick={() => onImageClick(item.imageUrl!)}
            >
                <img
                    src={item.imageUrl}
                    alt={item.key}
                    onError={() => setImgError(true)}
                    className="h-16 w-16 object-cover hover:scale-105 transition-transform"
                />
            </div>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-gray-900/80 text-white text-[9px] rounded capitalize opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                {item.key}
            </div>
        </div>
    );
}
