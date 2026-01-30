import { ReactNode, lazy, Suspense, ComponentType } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Lazy-loaded widget imports for code-splitting.
 * 
 * Why: Widgets like SalesChartWidget and CustomerGrowthWidget import echarts (~617KB).
 * By lazy loading all widgets, we ensure echarts only loads when a chart widget is
 * actually on the user's dashboard, reducing initial bundle by 600KB+.
 */

// Light widgets (no heavy dependencies)
const TotalSalesWidget = lazy(() => import('./TotalSalesWidget').then(m => ({ default: m.TotalSalesWidget })));
const RecentOrdersWidget = lazy(() => import('./RecentOrdersWidget').then(m => ({ default: m.RecentOrdersWidget })));
const AdSpendWidget = lazy(() => import('./AdSpendWidget').then(m => ({ default: m.AdSpendWidget })));
const LiveAnalyticsWidget = lazy(() => import('./LiveAnalyticsWidget').then(m => ({ default: m.LiveAnalyticsWidget })));
const TopProductsWidget = lazy(() => import('./TopProductsWidget').then(m => ({ default: m.TopProductsWidget })));
const InventoryRiskWidget = lazy(() => import('./InventoryRiskWidget').then(m => ({ default: m.InventoryRiskWidget })));
const VisitorCountWidget = lazy(() => import('./VisitorCountWidget').then(m => ({ default: m.VisitorCountWidget })));
const OpenInboxWidget = lazy(() => import('./OpenInboxWidget').then(m => ({ default: m.OpenInboxWidget })));
const GoldPriceMarginWidget = lazy(() => import('./GoldPriceMarginWidget').then(m => ({ default: m.GoldPriceMarginWidget })));

// Medium widgets (moderate bundle impact)
const LiveCartsWidget = lazy(() => import('./LiveCartsWidget'));
const VisitorLogWidget = lazy(() => import('./VisitorLogWidget'));
const EcommerceLogWidget = lazy(() => import('./EcommerceLogWidget'));
const HotCacheWidget = lazy(() => import('./HotCacheWidget'));
const QuickProductsWidget = lazy(() => import('./QuickProductsWidget'));
const AdSuggestionsWidget = lazy(() => import('./AdSuggestionsWidget').then(m => ({ default: m.AdSuggestionsWidget })));
const CartAbandonmentWidget = lazy(() => import('./CartAbandonmentWidget').then(m => ({ default: m.CartAbandonmentWidget })));

// Heavy widgets (echarts ~617KB) - deferred until actually rendered
const CustomerGrowthWidget = lazy(() => import('./CustomerGrowthWidget').then(m => ({ default: m.CustomerGrowthWidget })));
const SalesChartWidget = lazy(() => import('./SalesChartWidget').then(m => ({ default: m.SalesChartWidget })));

export interface WidgetProps {
    settings?: any;
    className?: string;
    dateRange: { startDate: string, endDate: string };
    comparison?: { startDate: string, endDate: string } | null;
}

type LazyWidget = React.LazyExoticComponent<ComponentType<WidgetProps>>;

/**
 * Widget skeleton shown while lazy widget chunk loads.
 */
function WidgetSkeleton() {
    return (
        <div className="card-premium h-full flex items-center justify-center bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="flex flex-col items-center gap-2 text-slate-400">
                <Loader2 className="animate-spin" size={20} />
                <span className="text-xs">Loading...</span>
            </div>
        </div>
    );
}

/**
 * Widget permission requirements mapped to RBAC permissions.
 * - view_finance: Revenue, sales, analytics data
 * - view_marketing: Ad spend, ROAS, marketing AI features
 * - view_products: Inventory, product performance
 * - view_orders: Order-related data
 * - undefined: No permission required (available to all users)
 */
export const WidgetRegistry: Record<string, {
    component: LazyWidget,
    label: string,
    defaultH: number,
    defaultW: number,
    requiredPermission?: string
}> = {
    'total-sales': { component: TotalSalesWidget, label: 'Total Sales', defaultW: 4, defaultH: 4, requiredPermission: 'view_finance' },
    'recent-orders': { component: RecentOrdersWidget, label: 'Recent Orders', defaultW: 4, defaultH: 8, requiredPermission: 'view_orders' },
    'marketing-roas': { component: AdSpendWidget, label: 'Marketing ROAS', defaultW: 4, defaultH: 4, requiredPermission: 'view_marketing' },
    'live-analytics': { component: LiveAnalyticsWidget, label: 'Live Analytics', defaultW: 4, defaultH: 3 },
    'top-products': { component: TopProductsWidget, label: 'Top Products', defaultW: 4, defaultH: 6, requiredPermission: 'view_finance' },
    'customer-growth': { component: CustomerGrowthWidget, label: 'Customer Growth', defaultW: 6, defaultH: 6, requiredPermission: 'view_finance' },
    'sales-chart': { component: SalesChartWidget, label: 'Sales Trend', defaultW: 6, defaultH: 6, requiredPermission: 'view_finance' },
    'inventory-risk': { component: InventoryRiskWidget, label: 'Inventory Risk', defaultW: 4, defaultH: 4, requiredPermission: 'view_products' },
    'live-carts': { component: LiveCartsWidget, label: 'Live Carts', defaultW: 4, defaultH: 4, requiredPermission: 'view_orders' },
    'visitor-log': { component: VisitorLogWidget, label: 'Visitor Log', defaultW: 6, defaultH: 6 },
    'ecommerce-log': { component: EcommerceLogWidget, label: 'Ecommerce Stream', defaultW: 6, defaultH: 6, requiredPermission: 'view_orders' },
    'hot-cache': { component: HotCacheWidget as any, label: 'Hot Cache', defaultW: 4, defaultH: 5 },
    'quick-products': { component: QuickProductsWidget as any, label: 'Quick Products', defaultW: 4, defaultH: 6, requiredPermission: 'view_products' },
    'visitor-count': { component: VisitorCountWidget, label: 'Live Visitors', defaultW: 3, defaultH: 2 },
    'open-inbox': { component: OpenInboxWidget, label: 'Open Inbox', defaultW: 3, defaultH: 2 },
    'ad-suggestions': { component: AdSuggestionsWidget, label: 'Ad Suggestions', defaultW: 4, defaultH: 5, requiredPermission: 'view_marketing' },
    'cart-abandonment': { component: CartAbandonmentWidget, label: 'Cart Abandonment', defaultW: 4, defaultH: 6, requiredPermission: 'view_finance' },
    'gold-price-margin': { component: GoldPriceMarginWidget, label: 'Gold Price Margins', defaultW: 4, defaultH: 5, requiredPermission: 'view_finance' }
};

/**
 * Renders a widget by key with Suspense boundary.
 * Each widget loads its own chunk on-demand, deferring heavy deps like echarts.
 */
export function renderWidget(key: string, props: WidgetProps): ReactNode {
    const entry = WidgetRegistry[key];
    if (!entry) return <div className="p-4 bg-red-50 text-red-500">Widget {key} not found</div>;
    const Component = entry.component;
    return (
        <Suspense fallback={<WidgetSkeleton />}>
            <Component {...props} />
        </Suspense>
    );
}
