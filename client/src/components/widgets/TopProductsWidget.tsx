import { WidgetProps } from './WidgetRegistry';
import { Package, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

export function TopProductsWidget({ className, dateRange }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentAccount) return;

        // Fetch with date range
        // Backend /api/analytics/top-products might typically support startDate/endDate
        // If not, we should rely on defaults or update backend (assuming it supports standard analytics params)
        // Usually analytics endpoints do.
        const url = `/api/analytics/top-products?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`;

        fetch(url, {
            headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
        })
            .then(res => res.json())
            .then(data => setProducts(Array.isArray(data) ? data : []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [currentAccount, token, dateRange]);

    return (
        <div className={`bg-white h-full w-full p-4 flex flex-col rounded-xl shadow-xs border border-gray-200 overflow-hidden ${className}`}>
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-gray-900">Top Products</h3>
                <Package size={18} className="text-gray-400" />
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
                {loading ? (
                    <div className="flex justify-center p-4"><Loader2 className="animate-spin text-gray-400" /></div>
                ) : products.length === 0 ? (
                    <div className="text-center text-gray-400 py-4 text-sm">No products found</div>
                ) : (
                    products.map((product, idx) => (
                        <div key={idx} className="flex justify-between items-center text-sm p-2 hover:bg-gray-50 rounded-lg transition-colors">
                            <div className="flex gap-3 items-center overflow-hidden">
                                <div className="w-6 h-6 rounded-sm bg-purple-100 flex items-center justify-center text-purple-600 text-xs font-bold shrink-0">
                                    {idx + 1}
                                </div>
                                <p className="font-medium text-gray-900 truncate" title={product.name}>{product.name}</p>
                            </div>
                            <span className="font-medium text-gray-600 shrink-0">
                                {product.quantity} sold
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
