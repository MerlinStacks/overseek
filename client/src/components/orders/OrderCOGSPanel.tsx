/**
 * OrderCOGSPanel - Displays COGS breakdown on order detail pages.
 *
 * Why gated client AND server side: The component returns null when the
 * user lacks `view_cogs`, and the API endpoint returns 403 independently.
 * Belt-and-braces for sensitive financial data.
 */

import { useState, useEffect, useCallback } from 'react';
import { DollarSign, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { formatCurrency } from '../../utils/format';
import { Logger } from '../../utils/logger';

interface COGSLineItem {
    productId: number;
    variationId: number;
    name: string;
    sku: string;
    quantity: number;
    unitCOGS: number;
    lineCOGS: number;
    lineRevenue: number;
}

interface COGSData {
    items: COGSLineItem[];
    totalCOGS: number;
    totalRevenue: number;
    paymentFees: number;
    grossProfit: number;
    margin: number;
}

interface OrderCOGSPanelProps {
    orderId: string;
    currency?: string;
}

/** Collapsible COGS breakdown card for order detail pages */
export function OrderCOGSPanel({ orderId, currency }: OrderCOGSPanelProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { hasPermission } = usePermissions();
    const canViewCogs = hasPermission('view_cogs');

    const [data, setData] = useState<COGSData | null>(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState(true);

    const fetchCOGS = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/orders/${orderId}/cogs`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount?.id || ''
                }
            });
            if (res.ok) {
                setData(await res.json());
            }
        } catch (err) {
            Logger.error('Failed to fetch order COGS', { error: err });
        } finally {
            setLoading(false);
        }
    }, [currentAccount?.id, orderId, token]);

    useEffect(() => {
        if (!canViewCogs || !orderId || !currentAccount || !token) return;
        fetchCOGS();
    }, [orderId, currentAccount, token, canViewCogs, fetchCOGS]);

    // Permission gate — nothing rendered for unauthorized users
    if (!canViewCogs) return null;

    const fmt = (v: number) => formatCurrency(v, currency || currentAccount?.currency || 'USD');

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between p-4 border-b border-gray-100 hover:bg-gray-50/50 transition-colors"
            >
                <div className="flex items-center gap-2 font-semibold text-gray-900">
                    <DollarSign size={18} className="text-emerald-500" />
                    COGS Breakdown
                </div>
                {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
            </button>

            {expanded && (
                <div className="p-4">
                    {loading ? (
                        <div className="flex items-center justify-center py-6 text-gray-400 text-sm">
                            <Loader2 size={16} className="animate-spin mr-2" /> Loading…
                        </div>
                    ) : !data || data.items.length === 0 ? (
                        <p className="text-sm text-gray-500 italic py-4 text-center">No COGS data available</p>
                    ) : (
                        <>
                            {/* Per-item breakdown */}
                            <div className="space-y-2 mb-4">
                                {data.items.map((item, idx) => (
                                    <div key={idx} className="flex items-start justify-between text-sm gap-2">
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium text-gray-800 truncate">{item.name}</div>
                                            <div className="text-xs text-gray-400">
                                                {item.sku ? `SKU: ${item.sku} · ` : ''}
                                                {item.quantity} × {fmt(item.unitCOGS)}
                                            </div>
                                        </div>
                                        <span className="text-gray-700 font-medium whitespace-nowrap">{fmt(item.lineCOGS)}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Summary */}
                            <div className="border-t border-gray-100 pt-3 space-y-1.5 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Total COGS</span>
                                    <span className="font-medium text-gray-800">{fmt(data.totalCOGS)}</span>
                                </div>
                                {data.paymentFees > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Payment Fees</span>
                                        <span className="font-medium text-gray-800">{fmt(data.paymentFees)}</span>
                                    </div>
                                )}
                                <div className="flex justify-between pt-1.5 border-t border-dashed border-gray-200">
                                    <span className="font-semibold text-gray-900">Gross Profit</span>
                                    <div className="flex items-center gap-2">
                                        <span className={`font-bold ${data.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                            {fmt(data.grossProfit)}
                                        </span>
                                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${data.margin >= 0
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                : 'bg-red-50 text-red-700 border border-red-200'
                                            }`}>
                                            {data.margin >= 0 ? '+' : ''}{data.margin.toFixed(1)}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
