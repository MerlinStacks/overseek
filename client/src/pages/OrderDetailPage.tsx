import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { formatDate } from '../utils/format';
import { ArrowLeft, User, MapPin, Mail, Phone, Package, CreditCard, RefreshCw } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { HistoryTimeline } from '../components/shared/HistoryTimeline';
import { Clock } from 'lucide-react';

export function OrderDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [order, setOrder] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [showRaw, setShowRaw] = useState(false);

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
        } catch (err) {
            setError('Could not load order details.');
        } finally {
            setIsLoading(false);
        }
    }

    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    // ... existing useEffect ...

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
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold text-gray-900">Order #{order.id}</h1>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide
              ${order.status === 'completed' ? 'bg-green-100 text-green-700' :
                                order.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                                    order.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                            {order.status}
                        </span>
                    </div>
                    <div className="text-sm text-gray-500 mt-1">Placed on {formatDate(order.date_created)} via {order.payment_method_title}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Main Content - Items */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
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
                                                    <div className="mt-1 space-y-0.5">
                                                        {item.meta_data.map((meta: any, idx: number) => (
                                                            <OrderMetaItem key={idx} meta={meta} onImageClick={setSelectedImage} />
                                                        ))}
                                                    </div>
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
                                        <td colSpan={3} className="px-6 py-2 text-right text-sm text-gray-500">Shipping</td>
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
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
                        <div className="font-semibold text-gray-900 flex items-center gap-2 border-b border-gray-100 pb-3">
                            <User size={18} className="text-blue-500" />
                            Customer Details
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-start gap-3">
                                <div className="p-2 bg-gray-100 rounded-full text-gray-500"><User size={14} /></div>
                                <div>
                                    <div className="text-sm font-medium text-gray-900">{billing.first_name} {billing.last_name}</div>
                                    <div className="text-xs text-gray-500">Customer</div>
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
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
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
                </div>

            </div>

            {/* History Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
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

// Helper to check if value is an image url
const isImage = (value: string) => {
    if (typeof value !== 'string') return false;
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(value);
};

function OrderMetaItem({ meta, onImageClick }: { meta: any, onImageClick: (url: string) => void }) {
    const [imgError, setImgError] = useState(false);

    // Filter out hidden meta (starts with _)
    if (meta.key.startsWith('_')) return null;

    const isImg = isImage(meta.value);
    const showImage = isImg && !imgError;

    return (
        <div className="text-xs text-gray-500 flex flex-col gap-1 mt-1">
            <div className="flex gap-1">
                <span className="font-medium bg-gray-100 px-1 rounded">{meta.key}:</span>
                {/* Show text if it's not an image, OR if the image failed to load */}
                {!showImage && (
                    <span className="break-all">
                        {/* If it looks like a URL, make it clickable */}
                        {meta.value.startsWith('http') ? (
                            <a href={meta.value} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                {meta.value}
                            </a>
                        ) : (
                            meta.value
                        )}
                    </span>
                )}
            </div>

            {showImage && (
                <div
                    className="mt-1 cursor-zoom-in border border-gray-200 rounded-md overflow-hidden inline-block w-fit"
                    onClick={() => onImageClick(meta.value)}
                >
                    <img
                        src={meta.value}
                        alt={meta.key}
                        onError={() => setImgError(true)}
                        className="h-24 w-auto object-cover hover:opacity-90 transition-opacity"
                    />
                </div>
            )}
        </div>
    );
}
