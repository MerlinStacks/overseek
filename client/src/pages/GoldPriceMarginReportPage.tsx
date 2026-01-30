/**
 * Gold Price Margin Report Page
 * 
 * Full report showing all products/variants with gold price enabled,
 * sorted by profit margin (lowest to highest).
 * Supports pagination for large datasets.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gem, ArrowLeft, TrendingDown, TrendingUp, Search, Loader2, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Logger } from '../utils/logger';
import { formatCurrency } from '../utils/format';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

// Margin thresholds for color coding
const MARGIN_THRESHOLD_LOW = 20;
const MARGIN_THRESHOLD_MEDIUM = 40;

// Pagination
const PAGE_SIZE = 50;

interface GoldPriceProduct {
    id: string;
    wooId: number;
    parentWooId?: number;
    name: string;
    variantName?: string;
    sku?: string;
    price: number;
    goldCogs: number;
    profitMargin: number;
    goldPriceType?: string;
    weight?: number;
    mainImage?: string;
    isVariant: boolean;
}

interface ReportData {
    count: number;
    page: number;
    limit: number;
    totalPages: number;
    products: GoldPriceProduct[];
}

/**
 * Returns color class based on margin percentage.
 */
function getMarginColor(margin: number): string {
    if (margin < MARGIN_THRESHOLD_LOW) return 'text-red-600 bg-red-50 dark:bg-red-900/20';
    if (margin < MARGIN_THRESHOLD_MEDIUM) return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20';
    return 'text-green-600 bg-green-50 dark:bg-green-900/20';
}

/**
 * Returns label for gold price type.
 */
function goldTypeLabel(type?: string): string {
    const labels: Record<string, string> = {
        '18ct': '18ct Yellow',
        '9ct': '9ct Yellow',
        '18ctWhite': '18ct White',
        '9ctWhite': '9ct White'
    };
    return type ? labels[type] || type : '-';
}

export function GoldPriceMarginReportPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<ReportData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);

    // Debounce search to avoid excessive filtering on each keystroke
    const debouncedSearch = useDebouncedValue(searchQuery, 300);

    const fetchReport = useCallback(async (page: number = 1) => {
        if (!currentAccount || !token) return;

        setError(null);
        setLoading(true);
        try {
            const res = await fetch(`/api/reports/gold-price/margin?page=${page}&limit=${PAGE_SIZE}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (!res.ok) {
                throw new Error(`Failed to load report (${res.status})`);
            }
            setData(await res.json());
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load report';
            Logger.error('Failed to load gold price report', { error: err });
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchReport(currentPage);
    }, [fetchReport, currentPage]);

    // Get currency from account (default to USD)
    const currency = currentAccount?.currency || 'USD';

    // Filter products by debounced search query (client-side for current page)
    const filteredProducts = data?.products.filter(p => {
        if (!debouncedSearch) return true;
        const query = debouncedSearch.toLowerCase();
        return p.name.toLowerCase().includes(query) ||
            p.variantName?.toLowerCase().includes(query) ||
            p.sku?.toLowerCase().includes(query);
    }) || [];

    // Pagination handlers
    const goToPage = (page: number) => {
        if (page >= 1 && page <= (data?.totalPages || 1)) {
            setCurrentPage(page);
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <Link
                    to="/"
                    className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-4"
                >
                    <ArrowLeft size={16} />
                    Back to Dashboard
                </Link>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-amber-100 dark:bg-amber-900/30 rounded-xl">
                            <Gem className="w-6 h-6 text-amber-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                                Gold Price Margin Report
                            </h1>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Products sorted by profit margin (lowest first)
                            </p>
                        </div>
                    </div>

                    {data && (
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                            <span className="font-mono bg-gray-100 dark:bg-slate-800 px-3 py-1 rounded-full">
                                {data.count} items
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Search */}
            <div className="mb-6">
                <div className="relative max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                        type="text"
                        placeholder="Search by name, variant, or SKU..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                    />
                </div>
            </div>

            {/* Loading State */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="animate-spin text-amber-500 mr-2" size={24} />
                    <span className="text-gray-500">Loading report...</span>
                </div>
            )}

            {/* Error State */}
            {!loading && error && (
                <div className="text-center py-20 border border-dashed border-red-200 dark:border-red-900 rounded-xl bg-red-50 dark:bg-red-900/10">
                    <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                        Failed to Load Report
                    </h3>
                    <p className="text-gray-500 dark:text-gray-400 mb-4">
                        {error}
                    </p>
                    <button
                        onClick={() => fetchReport(currentPage)}
                        className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* Empty State */}
            {!loading && !error && (!data || data.count === 0) && (
                <div className="text-center py-20 border border-dashed border-gray-200 dark:border-slate-700 rounded-xl">
                    <Gem className="w-12 h-12 text-gray-300 dark:text-slate-600 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                        No Gold Price Products
                    </h3>
                    <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                        Enable gold price calculation on products or variants to see them in this report.
                    </p>
                </div>
            )}

            {/* Results Table */}
            {!loading && !error && data && data.count > 0 && (
                <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
                                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                        Product
                                    </th>
                                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                        SKU
                                    </th>
                                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                        Gold Type
                                    </th>
                                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                        Weight (g)
                                    </th>
                                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                        Gold COGS
                                    </th>
                                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                        Price
                                    </th>
                                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                        Margin
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                                {filteredProducts.map((product) => (
                                    <tr
                                        key={product.id}
                                        className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
                                    >
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                {product.mainImage ? (
                                                    <img
                                                        src={product.mainImage}
                                                        alt=""
                                                        className="w-10 h-10 rounded-lg object-cover border border-gray-200 dark:border-slate-600"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center">
                                                        <Gem size={16} className="text-gray-400" />
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <Link
                                                        to={`/inventory/product/${product.parentWooId || product.wooId}`}
                                                        className="font-medium text-gray-900 dark:text-white hover:text-amber-600 transition-colors truncate block"
                                                    >
                                                        {product.name}
                                                    </Link>
                                                    {product.variantName && (
                                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                                            {product.variantName}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 font-mono">
                                            {product.sku || '-'}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                                            {goldTypeLabel(product.goldPriceType)}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 text-right font-mono">
                                            {product.weight ? product.weight.toFixed(2) : '-'}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 text-right font-mono">
                                            {formatCurrency(product.goldCogs, currency)}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white text-right font-mono font-medium">
                                            {formatCurrency(product.price, currency)}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm font-mono font-bold ${getMarginColor(product.profitMargin)}`}>
                                                {product.profitMargin < 30 ? (
                                                    <TrendingDown size={14} />
                                                ) : (
                                                    <TrendingUp size={14} />
                                                )}
                                                {product.profitMargin.toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Footer with Pagination */}
                    <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                                Showing {filteredProducts.length} of {data.count} items
                                {data.totalPages > 1 && ` (Page ${data.page} of ${data.totalPages})`}
                            </span>

                            {/* Pagination Controls */}
                            {data.totalPages > 1 && (
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => goToPage(currentPage - 1)}
                                        disabled={currentPage === 1}
                                        className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        aria-label="Previous page"
                                    >
                                        <ChevronLeft size={16} />
                                    </button>

                                    {/* Page numbers */}
                                    <div className="flex items-center gap-1">
                                        {Array.from({ length: Math.min(5, data.totalPages) }, (_, i) => {
                                            let pageNum: number;
                                            if (data.totalPages <= 5) {
                                                pageNum = i + 1;
                                            } else if (currentPage <= 3) {
                                                pageNum = i + 1;
                                            } else if (currentPage >= data.totalPages - 2) {
                                                pageNum = data.totalPages - 4 + i;
                                            } else {
                                                pageNum = currentPage - 2 + i;
                                            }

                                            return (
                                                <button
                                                    key={pageNum}
                                                    onClick={() => goToPage(pageNum)}
                                                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${pageNum === currentPage
                                                            ? 'bg-amber-500 text-white'
                                                            : 'hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-gray-300'
                                                        }`}
                                                >
                                                    {pageNum}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <button
                                        onClick={() => goToPage(currentPage + 1)}
                                        disabled={currentPage === data.totalPages}
                                        className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        aria-label="Next page"
                                    >
                                        <ChevronRight size={16} />
                                    </button>
                                </div>
                            )}

                            {filteredProducts.length > 0 && (
                                <span className="text-sm text-gray-500 dark:text-gray-400">
                                    Avg Margin: <span className="font-mono font-medium">
                                        {(filteredProducts.reduce((acc, p) => acc + p.profitMargin, 0) / filteredProducts.length).toFixed(1)}%
                                    </span>
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
