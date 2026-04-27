import { useEffect, useState, useCallback, useRef } from 'react';
import { Logger } from '../../utils/logger';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useWidgetSocket } from '../../hooks/useWidgetSocket';
import { WidgetProps } from './WidgetRegistry';
import { widgetCardClass, widgetTitleClass, widgetHeaderRowClass, widgetListRowClass } from './widgetStyles';

/**
 * RiskProduct - normalized shape for widget display.
 * Sourced from InventoryForecastService.getStockoutAlerts() SkuForecast type.
 */
interface RiskProduct {
    id: string;
    wooId: number;
    name: string;
    stock: number;
    velocity: string;
    daysRemaining: number;
    image?: string;
}

/** Shape returned by /api/analytics/inventory/stockout-alerts */
interface StockoutAlertsResponse {
    critical: SkuForecast[];
    high: SkuForecast[];
    medium: SkuForecast[];
    summary: {
        totalAtRisk: number;
        criticalCount: number;
        highCount: number;
        mediumCount: number;
    };
}

interface SkuForecast {
    id: string;
    wooId: number;
    name: string;
    sku: string | null;
    image: string | null;
    currentStock: number;
    dailyDemand: number;
    daysUntilStockout: number;
    stockoutRisk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export function InventoryRiskWidget({ className }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [products, setProducts] = useState<RiskProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const socketDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchRisk = useCallback(async () => {
        if (!currentAccount || !token) return;

        try {
            const res = await fetch('/api/analytics/inventory/stockout-alerts', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (res.ok) {
                const data: StockoutAlertsResponse = await res.json();
                const atRisk = [...data.critical, ...data.high].map((forecast) => ({
                    id: forecast.id,
                    wooId: forecast.wooId,
                    name: forecast.name,
                    stock: forecast.currentStock,
                    velocity: forecast.dailyDemand.toFixed(2),
                    daysRemaining: forecast.daysUntilStockout,
                    image: forecast.image ?? undefined
                }));
                setProducts(atRisk);
            }
        } catch (error) {
            Logger.error('Failed to load inventory risk', { error });
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchRisk();
    }, [fetchRisk]);

    useEffect(() => {
        return () => {
            if (socketDebounceRef.current) {
                clearTimeout(socketDebounceRef.current);
                socketDebounceRef.current = null;
            }
        };
    }, []);

    // Real-time: debounced refresh on inventory updates.
    useWidgetSocket('inventory:updated', () => {
        if (socketDebounceRef.current) clearTimeout(socketDebounceRef.current);
        socketDebounceRef.current = setTimeout(() => fetchRisk(), 3000);
    });

    if (loading) {
        return (
            <div className={`${widgetCardClass} p-4 h-full flex items-center justify-center ${className || ''}`}>
                <div className="text-center text-xs text-slate-500 dark:text-slate-400">Analysis...</div>
            </div>
        );
    }

    if (products.length === 0) {
        return (
            <div className={`${widgetCardClass} h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 p-4 ${className || ''}`}>
                <div className="bg-emerald-50 dark:bg-emerald-500/10 p-3 rounded-full mb-2">
                    <AlertTriangle className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
                </div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Healthy Stock</p>
                <p className="text-xs">No products at immediate risk.</p>
            </div>
        );
    }

    return (
        <div className={`${widgetCardClass} flex flex-col h-full p-4 ${className || ''}`}>
            <div className={`${widgetHeaderRowClass} px-1`}>
                <h3 className={`${widgetTitleClass} flex items-center gap-2`}>
                    <AlertTriangle size={16} className="text-amber-500" />
                    Stock Risks
                </h3>
                <span className="text-xs font-mono bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-2 py-0.5 rounded-full">
                    {products.length} Critical
                </span>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
                {products.slice(0, 5).map((product) => (
                    <div key={product.id} className={`flex items-center gap-3 ${widgetListRowClass} hover:bg-slate-50 dark:hover:bg-slate-700/50 border border-transparent hover:border-slate-100 dark:hover:border-slate-600`}>
                        {product.image ? (
                            <img src={product.image} alt="" className="w-10 h-10 rounded-md object-cover border border-slate-200 dark:border-slate-600" loading="lazy" />
                        ) : (
                            <div className="w-10 h-10 rounded-md bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400 dark:text-slate-500">
                                <span className="text-xs">IMG</span>
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{product.name}</p>
                            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-mono text-red-600 dark:text-red-400 font-bold">{product.daysRemaining} days left</span>
                                <span>&middot;</span>
                                <span>{product.stock} units</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <a href="/inventory/forecast" className="mt-4 flex items-center justify-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 pt-2 border-t border-slate-100 dark:border-slate-700">
                View All Risks <ArrowRight size={12} />
            </a>
        </div>
    );
}
