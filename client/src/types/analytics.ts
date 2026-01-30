/**
 * Analytics Types
 * 
 * Type definitions for the reports system including dimensions, metrics, and templates.
 */

/** Available dimensions for grouping report data */
export type ReportDimension =
    | 'day' | 'month' | 'product' | 'category' | 'customer' | 'customer_segment'
    | 'traffic_source' | 'utm_source' | 'device' | 'country' | 'order_status';

/** Available metrics for report calculations */
export type ReportMetric =
    | 'sales' | 'orders' | 'aov' | 'quantity'
    | 'visitors' | 'sessions' | 'page_views' | 'conversion_rate' | 'new_customers';

/** Dimension options with display labels and categories */
export const DIMENSION_OPTIONS: { value: ReportDimension; label: string; category: 'time' | 'sales' | 'traffic' }[] = [
    // Time Dimensions
    { value: 'day', label: 'Day', category: 'time' },
    { value: 'month', label: 'Month', category: 'time' },
    // Sales Dimensions
    { value: 'product', label: 'Product', category: 'sales' },
    { value: 'category', label: 'Category', category: 'sales' },
    { value: 'customer', label: 'Customer', category: 'sales' },
    { value: 'order_status', label: 'Order Status', category: 'sales' },
    { value: 'customer_segment', label: 'Customer Segment', category: 'sales' },
    // Traffic Dimensions
    { value: 'traffic_source', label: 'Traffic Source', category: 'traffic' },
    { value: 'utm_source', label: 'UTM Source', category: 'traffic' },
    { value: 'device', label: 'Device Type', category: 'traffic' },
    { value: 'country', label: 'Country', category: 'traffic' }
];

/** Metric options with display labels, categories, and formatting hints */
export const METRIC_OPTIONS: {
    value: ReportMetric;
    label: string;
    category: 'sales' | 'traffic' | 'conversion';
    format: 'currency' | 'number' | 'percent';
}[] = [
        // Sales Metrics
        { value: 'sales', label: 'Revenue', category: 'sales', format: 'currency' },
        { value: 'orders', label: 'Orders', category: 'sales', format: 'number' },
        { value: 'aov', label: 'Avg Order Value', category: 'sales', format: 'currency' },
        { value: 'quantity', label: 'Units Sold', category: 'sales', format: 'number' },
        { value: 'new_customers', label: 'New Customers', category: 'sales', format: 'number' },
        // Traffic Metrics
        { value: 'sessions', label: 'Sessions', category: 'traffic', format: 'number' },
        { value: 'visitors', label: 'Visitors', category: 'traffic', format: 'number' },
        { value: 'page_views', label: 'Page Views', category: 'traffic', format: 'number' },
        // Conversion Metrics
        { value: 'conversion_rate', label: 'Conversion Rate', category: 'conversion', format: 'percent' }
    ];

export interface ReportResult {
    dimension: string;
    sales?: number;
    orders?: number;
    aov?: number;
    quantity?: number;
    visitors?: number;
    sessions?: number;
    page_views?: number;
    conversion_rate?: number;
    new_customers?: number;
    [key: string]: string | number | undefined;
}

export interface ReportTemplate {
    id: string;
    name: string;
    type: 'CUSTOM' | 'SYSTEM' | 'SYSTEM_CLONE';
    category?: 'Sales' | 'Traffic' | 'Customer' | 'Conversion';
    config: {
        metrics: string[];
        dimension: string;
        dateRange: string;
    };
}

export interface LiveSession {
    id: string;
    visitorId: string;
    country: string | null;
    city: string | null;
    deviceType: string | null;
    os: string | null;
    browser: string | null;
    currentPath: string | null;
    lastActiveAt: string;
    cartValue: number;
    cartItems: any;
    referrer: string | null;
    utmSource: string | null;
    utmCampaign: string | null;
    customer?: {
        firstName?: string | null;
        lastName?: string | null;
        email?: string;
    } | null;
}
