/**
 * Campaign Products Panel
 * 
 * Displays products for an expanded campaign row.
 * Fetches products on demand when campaign is expanded.
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Loader2, Package, TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency, formatCompact } from '../../utils/format';

interface ShoppingProduct {
    campaignId: string;
    campaignName: string;
    productId: string;
    productTitle: string;
    productBrand: string;
    productCategory: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionsValue: number;
    roas: number;
    ctr: number;
    cpc: number;
    currency: string;
}

interface CampaignProductsPanelProps {
    adAccountId: string;
    campaignId: string;
    days: number;
}

export function CampaignProductsPanel({ adAccountId, campaignId, days }: CampaignProductsPanelProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [products, setProducts] = useState<ShoppingProduct[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchProducts();
    }, [adAccountId, campaignId, days]);

    async function fetchProducts() {
        setIsLoading(true);
        setError(null);
        try {
            const headers = {
                'Authorization': `Bearer ${token}`,
                'X-Account-ID': currentAccount?.id || ''
            };
            const res = await fetch(
                `/api/ads/${adAccountId}/campaigns/${campaignId}/products?days=${days}`,
                { headers }
            );
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to load products');
            }
            const data = await res.json();
            setProducts(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }

    const formatNumber = (v: number) =>
        formatCompact(v);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-6 bg-gray-50">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500 mr-2" />
                <span className="text-sm text-gray-500">Loading products...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-4 px-6 bg-red-50 text-red-600 text-sm">
                {error}
            </div>
        );
    }

    if (products.length === 0) {
        return (
            <div className="py-6 px-6 bg-gray-50 text-center">
                <Package className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No products in this campaign</p>
                <p className="text-xs text-gray-400 mt-1">
                    This may be a non-Shopping campaign or no product data is available.
                </p>
            </div>
        );
    }

    // Sort by spend descending
    const sortedProducts = [...products].sort((a, b) => b.spend - a.spend);

    return (
        <div className="bg-gray-50 border-t">
            <div className="px-6 py-3 border-b bg-gray-100">
                <span className="text-sm font-medium text-gray-700">
                    {products.length} Product{products.length !== 1 ? 's' : ''} in Campaign
                </span>
            </div>
            <div className="divide-y divide-gray-200">
                {sortedProducts.slice(0, 10).map((product, idx) => (
                    <div key={`${product.productId}-${idx}`} className="px-6 py-3 flex items-center justify-between hover:bg-gray-100 transition-colors">
                        <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate" title={product.productTitle}>
                                {product.productTitle}
                            </p>
                            <p className="text-xs text-gray-500">
                                {product.productBrand && `${product.productBrand} • `}
                                ID: {product.productId}
                            </p>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                            <div className="text-right">
                                <p className="text-gray-900 font-medium">
                                    {formatCurrency(product.spend, product.currency)}
                                </p>
                                <p className="text-xs text-gray-500">Spend</p>
                            </div>
                            <div className="text-right">
                                <p className="text-gray-700">{formatNumber(product.clicks)}</p>
                                <p className="text-xs text-gray-500">Clicks</p>
                            </div>
                            <div className="text-right">
                                <p className="text-gray-700">{product.conversions.toFixed(0)}</p>
                                <p className="text-xs text-gray-500">Conv.</p>
                            </div>
                            <div className="text-right w-16">
                                <p className={`font-medium flex items-center justify-end gap-1 ${product.roas >= 3 ? 'text-green-600' :
                                    product.roas >= 1 ? 'text-yellow-600' : 'text-red-600'
                                    }`}>
                                    {product.roas >= 3 ? <TrendingUp size={12} /> :
                                        product.roas < 1 ? <TrendingDown size={12} /> : null}
                                    {product.roas.toFixed(2)}x
                                </p>
                                <p className="text-xs text-gray-500">ROAS</p>
                            </div>
                        </div>
                    </div>
                ))}
                {products.length > 10 && (
                    <div className="px-6 py-2 text-center text-xs text-gray-500 bg-gray-100">
                        Showing top 10 of {products.length} products
                    </div>
                )}
            </div>
        </div>
    );
}
