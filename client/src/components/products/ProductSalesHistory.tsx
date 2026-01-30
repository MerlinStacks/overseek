import { useEffect, useState } from 'react';
import { Logger } from '../../utils/logger';
import { ShoppingCart, ExternalLink, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { format } from 'date-fns';
import { formatCurrency } from '../../utils/format';
import { getStatusBadgeClasses } from '../../utils/orderStatus';

interface SaleRecord {
    orderId: number;
    orderNumber: string;
    date: string;
    status: string;
    customerName: string;
    customerEmail: string;
    quantity: number;
    lineTotal: number;
    orderTotal: number;
    currency: string;
}

interface SalesHistoryResponse {
    sales: SaleRecord[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

interface ProductSalesHistoryProps {
    productWooId: number;
}

/**
 * Displays a paginated list of orders containing this product.
 * Fetches data from /api/products/:id/sales-history endpoint.
 */
export function ProductSalesHistory({ productWooId }: ProductSalesHistoryProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<SalesHistoryResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);

    useEffect(() => {
        if (!currentAccount || !token) return;

        const fetchSalesHistory = async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/products/${productWooId}/sales-history?page=${page}&limit=15`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id
                    }
                });
                if (res.ok) {
                    setData(await res.json());
                }
            } catch (error) {
                Logger.error('Failed to fetch sales history', { error: error });
            } finally {
                setLoading(false);
            }
        };

        fetchSalesHistory();
    }, [productWooId, currentAccount, token, page]);

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="animate-spin text-blue-600" size={24} />
                <span className="ml-2 text-gray-500">Loading sales history...</span>
            </div>
        );
    }

    if (!data || data.sales.length === 0) {
        return (
            <div className="p-8 text-center text-gray-400">
                <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-lg font-medium">No sales found</p>
                <p className="text-sm mt-1">This product hasn't been sold yet, or orders haven't synced.</p>
            </div>
        );
    }

    return (
        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100/50">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
                        <ShoppingCart size={16} className="text-blue-600" />
                        Sales History
                    </h3>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                        {data.total} order{data.total !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>

            {/* Sales Table */}
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="bg-gray-50/50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            <th className="px-6 py-3">Order</th>
                            <th className="px-6 py-3">Date</th>
                            <th className="px-6 py-3">Customer</th>
                            <th className="px-6 py-3 text-center">Qty</th>
                            <th className="px-6 py-3 text-right">Line Total</th>
                            <th className="px-6 py-3 text-right">Order Total</th>
                            <th className="px-6 py-3 text-center">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100/50">
                        {data.sales.map((sale) => (
                            <tr key={sale.orderId} className="hover:bg-gray-50/50 transition-colors">
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-gray-900">{sale.orderNumber}</span>
                                        {currentAccount?.wooUrl && (
                                            <a
                                                href={`${currentAccount.wooUrl}/wp-admin/post.php?post=${sale.orderId}&action=edit`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-blue-600 hover:text-blue-800 transition-colors"
                                                title="Open in WooCommerce"
                                            >
                                                <ExternalLink size={14} />
                                            </a>
                                        )}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                    {format(new Date(sale.date), 'MMM d, yyyy')}
                                    <span className="block text-xs text-gray-400">
                                        {format(new Date(sale.date), 'h:mm a')}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="text-sm font-medium text-gray-900">{sale.customerName}</div>
                                    {sale.customerEmail && (
                                        <div className="text-xs text-gray-500">{sale.customerEmail}</div>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-1 bg-blue-50 text-blue-700 text-sm font-medium rounded-sm">
                                        {sale.quantity}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">
                                    {formatCurrency(sale.lineTotal, sale.currency)}
                                </td>
                                <td className="px-6 py-4 text-right text-sm font-medium text-gray-700">
                                    {formatCurrency(sale.orderTotal, sale.currency)}
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full border capitalize ${getStatusBadgeClasses(sale.status)}`}>
                                        {sale.status.replace('-', ' ')}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {data.totalPages > 1 && (
                <div className="px-6 py-4 border-t border-gray-100/50 flex items-center justify-between">
                    <span className="text-sm text-gray-500">
                        Page {data.page} of {data.totalPages}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page <= 1}
                            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button
                            onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                            disabled={page >= data.totalPages}
                            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
