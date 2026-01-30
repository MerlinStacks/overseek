import { X, ExternalLink, Package } from 'lucide-react';
import { Logger } from '../../utils/logger';
import { formatDate, formatCurrency } from '../../utils/format';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface OrderPreviewModalProps {
    orderId: number | null;
    isOpen: boolean;
    onClose: () => void;
}

export function OrderPreviewModal({ orderId, isOpen, onClose }: OrderPreviewModalProps) {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [order, setOrder] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen && orderId && currentAccount && token) {
            fetchOrderDetails();
        } else {
            setOrder(null);
        }
    }, [isOpen, orderId, currentAccount, token]);

    async function fetchOrderDetails() {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/orders/${orderId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount?.id || ''
                }
            });
            if (res.ok) {
                const data = await res.json();
                setOrder(data);
            }
        } catch (error) {
            Logger.error('Failed to load order', { error: error });
        } finally {
            setIsLoading(false);
        }
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100 flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Order #{orderId}</h2>
                        <p className="text-sm text-gray-500">Quick Preview</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto space-y-5">
                    {isLoading ? (
                        <div className="py-12 text-center">
                            <div className="inline-block w-8 h-8 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin mb-3"></div>
                            <p className="text-gray-500 text-sm">Loading order details...</p>
                        </div>
                    ) : order ? (
                        <>
                            {/* Status & Date Row */}
                            <div className="flex items-center justify-between">
                                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide
                                    ${order.status === 'completed' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' :
                                        order.status === 'processing' ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' :
                                            order.status === 'pending' ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' :
                                                order.status === 'on-hold' ? 'bg-purple-50 text-purple-700 ring-1 ring-purple-200' :
                                                    order.status === 'cancelled' || order.status === 'failed' ? 'bg-red-50 text-red-700 ring-1 ring-red-200' :
                                                        order.status === 'refunded' ? 'bg-slate-50 text-slate-700 ring-1 ring-slate-200' :
                                                            'bg-gray-50 text-gray-700 ring-1 ring-gray-200'}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full 
                                        ${order.status === 'completed' ? 'bg-emerald-500' :
                                            order.status === 'processing' ? 'bg-amber-500' :
                                                order.status === 'pending' ? 'bg-orange-500' :
                                                    order.status === 'on-hold' ? 'bg-purple-500' :
                                                        order.status === 'cancelled' || order.status === 'failed' ? 'bg-red-500' :
                                                            order.status === 'refunded' ? 'bg-slate-500' :
                                                                'bg-gray-500'}`}></span>
                                    {order.status}
                                </span>
                                <span className="text-sm text-gray-500 font-medium">{formatDate(order.date_created)}</span>
                            </div>

                            {/* Customer Card */}
                            <div className="bg-linear-to-br from-slate-50 to-gray-50 rounded-xl p-4 border border-gray-200/80 shadow-xs">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-10 h-10 bg-linear-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-semibold text-sm shadow-xs">
                                        {order.billing?.first_name?.charAt(0) || ''}{order.billing?.last_name?.charAt(0) || ''}
                                    </div>
                                    <div>
                                        <div className="font-semibold text-gray-900">{order.billing?.first_name} {order.billing?.last_name}</div>
                                        <div className="text-sm text-gray-500 truncate max-w-[200px]">{order.billing?.email}</div>
                                    </div>
                                </div>
                            </div>

                            {/* Items Section */}
                            <div className="rounded-xl border border-gray-200/80 overflow-hidden shadow-xs">
                                <div className="px-4 py-3 bg-linear-to-r from-gray-50 to-slate-50 border-b border-gray-200/80 flex items-center justify-between">
                                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Order Items</span>
                                    <span className="text-xs font-medium text-gray-400 bg-gray-200/60 px-2 py-0.5 rounded-full">{order.line_items?.length || 0} item{order.line_items?.length !== 1 ? 's' : ''}</span>
                                </div>
                                <div className="divide-y divide-gray-100 bg-white max-h-48 overflow-y-auto">
                                    {order.line_items?.map((item: any) => (
                                        <div key={item.id} className="p-3.5 flex justify-between items-start gap-3 hover:bg-gray-50/50 transition-colors">
                                            <div className="flex items-start gap-3 flex-1 min-w-0">
                                                <div className="w-9 h-9 bg-linear-to-br from-gray-100 to-gray-50 border border-gray-200 rounded-lg flex items-center justify-center text-gray-400 shrink-0">
                                                    <Package size={16} />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-medium text-gray-900 text-sm leading-tight line-clamp-2">{item.name}</div>
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        {item.quantity} × {formatCurrency(item.price, order.currency)}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="font-semibold text-gray-900 text-sm shrink-0">
                                                {formatCurrency(item.total, order.currency)}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Total Row */}
                                <div className="px-4 py-3.5 bg-linear-to-r from-gray-800 to-slate-900 flex items-center justify-between">
                                    <span className="text-sm font-medium text-gray-300 uppercase tracking-wide">Total</span>
                                    <span className="text-xl font-bold text-white">
                                        {formatCurrency(Number(order.total), order.currency || 'USD')}
                                    </span>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="text-center py-8">
                            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                <X size={24} className="text-red-500" />
                            </div>
                            <p className="text-gray-600 font-medium">Failed to load order data</p>
                            <p className="text-sm text-gray-400 mt-1">Please try again later</p>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-5 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-200 rounded-lg transition-colors">
                        Close
                    </button>
                    <button
                        onClick={() => navigate(`/orders/${orderId}`)}
                        className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-xs shadow-blue-200 transition-all hover:shadow-md"
                    >
                        View Full Details
                        <ExternalLink size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
