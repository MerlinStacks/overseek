import type { ReactNode } from 'react';
import { BarChart3, DollarSign, Package, ShoppingCart, TrendingUp, Users } from 'lucide-react';
import { formatCompact, formatCurrency, formatNumber } from '../../../utils/format';
import { Metric, MetricStrip } from '../../ui/MetricStrip';

interface SalesData {
    date: string;
    sales: number;
    orders: number;
}

interface TopProduct {
    name: string;
    quantity: number;
}

interface CustomerGrowth {
    newCustomers: number;
}

interface ReportsOverviewTabProps {
    isLoading: boolean;
    salesData: SalesData[];
    topProducts: TopProduct[];
    customerGrowth: CustomerGrowth[];
    currency?: string;
}

function MetricCard({ icon, label, value, helper, colorClass }: {
    icon: ReactNode;
    label: string;
    value: string;
    helper: string;
    colorClass: string;
}) {
    return (
        <Metric label={<span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={colorClass}>{icon}</span>{label}</span>} value={value} hint={helper} />
    );
}

function MetricSkeleton() {
    return (
        <Metric label="Loading summary…" value={<span className="block h-6 w-24 animate-pulse rounded bg-gray-100 dark:bg-slate-700" />} />
    );
}

export function ReportsOverviewTab({ isLoading, salesData, topProducts, customerGrowth, currency = 'USD' }: ReportsOverviewTabProps) {
    const totalRevenue = salesData.reduce((acc, curr) => acc + curr.sales, 0);
    const newCustomersCount = customerGrowth.reduce((acc, curr) => acc + curr.newCustomers, 0);
    const totalOrders = salesData.reduce((acc, curr) => acc + curr.orders, 0);
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const maxSales = Math.max(...salesData.map(s => s.sales), 1);
    const topProductTotal = topProducts.reduce((acc, curr) => acc + curr.quantity, 0);

    return (
        <>
            <MetricStrip label={isLoading ? 'Loading report summary' : 'Report summary'}>
                {isLoading ? (
                    <>
                        <MetricSkeleton />
                        <MetricSkeleton />
                        <MetricSkeleton />
                        <MetricSkeleton />
                    </>
                ) : (
                    <>
                        <MetricCard
                            icon={<DollarSign size={14} />}
                            label="Total Revenue"
                            value={formatCurrency(totalRevenue, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            helper="Selected period"
                            colorClass="bg-green-100 text-green-600 dark:bg-green-900/30"
                        />
                        <MetricCard
                            icon={<ShoppingCart size={14} />}
                            label="Orders"
                            value={formatNumber(totalOrders)}
                            helper="Completed orders"
                            colorClass="bg-[var(--brand-subtle)] text-[var(--brand-text)]"
                        />
                        <MetricCard
                            icon={<TrendingUp size={14} />}
                            label="Avg Order Value"
                            value={formatCurrency(avgOrderValue, currency)}
                            helper="Revenue ÷ completed orders"
                            colorClass="bg-[var(--brand-subtle)] text-[var(--brand-text)]"
                        />
                        <MetricCard
                            icon={<Users size={14} />}
                            label="New Customers"
                            value={formatNumber(newCustomersCount)}
                            helper="First seen this period"
                            colorClass="bg-orange-100 text-orange-600 dark:bg-orange-900/30"
                        />
                    </>
                )}
            </MetricStrip>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
                    <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Revenue Trend</h3>
                            <p className="text-sm text-gray-500 dark:text-slate-400">Daily revenue distribution for the selected range</p>
                        </div>
                        {!isLoading && salesData.length > 0 && (
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600 dark:bg-blue-900/30">
                                {salesData.length} data points
                            </span>
                        )}
                    </div>
                    <div className="relative flex h-72 items-end justify-between gap-1 rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
                        {isLoading ? (
                            <div className="flex h-full w-full items-end gap-1">
                                {Array.from({ length: 18 }).map((_, i) => (
                                    <div key={i} className="flex-1 animate-pulse rounded-t bg-gray-200 dark:bg-slate-700" style={{ height: `${24 + ((i * 17) % 58)}%` }} />
                                ))}
                            </div>
                        ) : salesData.length === 0 ? (
                            <div className="flex h-full w-full flex-col items-center justify-center text-center text-gray-400">
                                <BarChart3 size={36} className="mb-3 text-gray-300" />
                                <p className="font-medium text-gray-500 dark:text-slate-300">No revenue data yet</p>
                                <p className="mt-1 text-sm dark:text-slate-500">Try a wider date range or wait for new orders to sync.</p>
                            </div>
                        ) : (
                            salesData.map((d, i) => {
                                const height = (d.sales / maxSales) * 100;
                                return (
                                    <div key={i} className="group relative flex flex-1 flex-col items-center justify-end">
                                        <div className="w-full rounded-t bg-blue-500 transition-all hover:bg-blue-600" style={{ height: `${Math.max(height, 3)}%` }} />
                                        <div className="absolute bottom-full z-10 mb-2 hidden whitespace-nowrap rounded-lg bg-gray-950 px-3 py-2 text-xs text-white shadow-lg group-hover:block">
                                            <span className="font-semibold">{formatCurrency(d.sales, currency)}</span>
                                            <span className="ml-2 text-gray-300">{d.orders} orders</span>
                                            <div className="text-gray-400">{d.date}</div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-6 flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Top Selling Products</h3>
                            <p className="text-sm text-gray-500 dark:text-slate-400">Best movers by quantity sold</p>
                        </div>
                        {!isLoading && topProductTotal > 0 && (
                            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                                {formatCompact(topProductTotal)} sold
                            </span>
                        )}
                    </div>
                    <div className="space-y-4">
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-100 dark:bg-slate-700" />
                                        <div className="h-4 w-36 animate-pulse rounded bg-gray-100 dark:bg-slate-700" />
                                    </div>
                                    <div className="h-4 w-12 animate-pulse rounded bg-gray-100 dark:bg-slate-700" />
                                </div>
                            ))
                        ) : topProducts.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-gray-400 dark:border-slate-700">
                                <Package size={30} className="mx-auto mb-3 text-gray-300" />
                                <p className="font-medium text-gray-500 dark:text-slate-300">No products sold yet</p>
                                <p className="mt-1 text-sm dark:text-slate-500">Product leaders will appear after orders sync.</p>
                            </div>
                        ) : topProducts.map((p, i) => (
                            <div key={i} className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400 dark:bg-slate-700">
                                        <Package size={14} />
                                    </div>
                                    <span className="truncate text-sm font-medium text-gray-900 dark:text-white">{p.name || 'Unknown Product'}</span>
                                </div>
                                <span className="shrink-0 text-sm font-bold text-gray-900 dark:text-slate-100">{formatNumber(p.quantity)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </>
    );
}
