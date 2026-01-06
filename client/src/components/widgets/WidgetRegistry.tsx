import { ReactNode } from 'react';
import { TotalSalesWidget } from './TotalSalesWidget';
import { RecentOrdersWidget } from './RecentOrdersWidget';
import { AdSpendWidget } from './AdSpendWidget';
import { LiveAnalyticsWidget } from './LiveAnalyticsWidget';
import { TopProductsWidget } from './TopProductsWidget';
import { CustomerGrowthWidget } from './CustomerGrowthWidget';
import { SalesChartWidget } from './SalesChartWidget';
import { InventoryRiskWidget } from './InventoryRiskWidget';
import LiveCartsWidget from './LiveCartsWidget';
import VisitorLogWidget from './VisitorLogWidget';
import EcommerceLogWidget from './EcommerceLogWidget';
import HotCacheWidget from './HotCacheWidget';
import QuickProductsWidget from './QuickProductsWidget';
import { VisitorCountWidget } from './VisitorCountWidget';

export interface WidgetProps {
    settings?: any;
    className?: string;
    dateRange: { startDate: string, endDate: string };
    comparison?: { startDate: string, endDate: string } | null;
}

export const WidgetRegistry: Record<string, { component: React.FC<WidgetProps>, label: string, defaultH: number, defaultW: number }> = {
    'total-sales': { component: TotalSalesWidget, label: 'Total Sales', defaultW: 4, defaultH: 4 },
    'recent-orders': { component: RecentOrdersWidget, label: 'Recent Orders', defaultW: 4, defaultH: 8 },
    'marketing-roas': { component: AdSpendWidget, label: 'Marketing ROAS', defaultW: 4, defaultH: 4 },
    'live-analytics': { component: LiveAnalyticsWidget, label: 'Live Analytics', defaultW: 4, defaultH: 3 },
    'top-products': { component: TopProductsWidget, label: 'Top Products', defaultW: 4, defaultH: 6 },
    'customer-growth': { component: CustomerGrowthWidget, label: 'Customer Growth', defaultW: 6, defaultH: 6 },
    'sales-chart': { component: SalesChartWidget, label: 'Sales Trend', defaultW: 6, defaultH: 6 },
    'inventory-risk': { component: InventoryRiskWidget, label: 'Inventory Risk', defaultW: 4, defaultH: 4 },
    'live-carts': { component: LiveCartsWidget, label: 'Live Carts', defaultW: 4, defaultH: 4 },
    'visitor-log': { component: VisitorLogWidget, label: 'Visitor Log', defaultW: 6, defaultH: 6 },
    'ecommerce-log': { component: EcommerceLogWidget, label: 'Ecommerce Stream', defaultW: 6, defaultH: 6 },
    'hot-cache': { component: HotCacheWidget as any, label: 'Hot Cache', defaultW: 4, defaultH: 5 },
    'quick-products': { component: QuickProductsWidget as any, label: 'Quick Products', defaultW: 4, defaultH: 6 },
    'visitor-count': { component: VisitorCountWidget, label: 'Live Visitors', defaultW: 3, defaultH: 2 }
};

export function renderWidget(key: string, props: WidgetProps): ReactNode {
    const entry = WidgetRegistry[key];
    if (!entry) return <div className="p-4 bg-red-50 text-red-500">Widget {key} not found</div>;
    const Component = entry.component;
    return <Component {...props} />;
}
