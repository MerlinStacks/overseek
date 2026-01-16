/**
 * Centralized Order Status Configuration.
 * 
 * Why: Status colors, icons, and labels were duplicated in 4+ files:
 * - MobileOrders.tsx
 * - MobileCustomerDetail.tsx  
 * - ContactPanel.tsx
 * - OrdersPage.tsx
 */

import {
    Clock,
    Package,
    Truck,
    CheckCircle,
    XCircle,
    RefreshCw,
    AlertCircle,
    type LucideIcon
} from 'lucide-react';

export interface StatusConfig {
    icon: LucideIcon;
    color: string;
    bg: string;
    label: string;
    /** Next status in the workflow (for status advancement) */
    next?: string;
}

/**
 * Complete order status configuration map.
 * Covers all WooCommerce standard statuses plus common custom ones.
 */
export const ORDER_STATUS_CONFIG: Record<string, StatusConfig> = {
    pending: {
        icon: Clock,
        color: 'text-amber-600',
        bg: 'bg-amber-100',
        label: 'Pending',
        next: 'processing'
    },
    processing: {
        icon: Package,
        color: 'text-blue-600',
        bg: 'bg-blue-100',
        label: 'Processing',
        next: 'shipped'
    },
    'on-hold': {
        icon: AlertCircle,
        color: 'text-orange-600',
        bg: 'bg-orange-100',
        label: 'On Hold',
        next: 'processing'
    },
    shipped: {
        icon: Truck,
        color: 'text-purple-600',
        bg: 'bg-purple-100',
        label: 'Shipped',
        next: 'completed'
    },
    delivered: {
        icon: CheckCircle,
        color: 'text-emerald-600',
        bg: 'bg-emerald-100',
        label: 'Delivered'
    },
    completed: {
        icon: CheckCircle,
        color: 'text-emerald-600',
        bg: 'bg-emerald-100',
        label: 'Completed'
    },
    cancelled: {
        icon: XCircle,
        color: 'text-red-600',
        bg: 'bg-red-100',
        label: 'Cancelled'
    },
    refunded: {
        icon: RefreshCw,
        color: 'text-gray-600',
        bg: 'bg-gray-100',
        label: 'Refunded'
    },
    failed: {
        icon: XCircle,
        color: 'text-red-600',
        bg: 'bg-red-100',
        label: 'Failed'
    }
};

/** Default config for unknown statuses */
const DEFAULT_STATUS: StatusConfig = {
    icon: Clock,
    color: 'text-gray-600',
    bg: 'bg-gray-100',
    label: 'Unknown'
};

/**
 * Get the full status configuration for a given status string.
 * Handles case-insensitive matching and unknown statuses.
 */
export function getStatusConfig(status: string): StatusConfig {
    const normalized = status?.toLowerCase().trim() || 'pending';
    return ORDER_STATUS_CONFIG[normalized] || DEFAULT_STATUS;
}

/**
 * Get just the Tailwind color classes for a status badge.
 * Returns combined background + text color classes.
 */
export function getStatusColor(status: string): string {
    const config = getStatusConfig(status);
    return `${config.bg} ${config.color}`;
}

/**
 * Get the display label for a status.
 */
export function getStatusLabel(status: string): string {
    return getStatusConfig(status).label;
}

/**
 * Get the icon component for a status.
 */
export function getStatusIcon(status: string): LucideIcon {
    return getStatusConfig(status).icon;
}

/**
 * Filter options for order list views.
 */
export const ORDER_FILTER_OPTIONS = ['All', 'Pending', 'Processing', 'Shipped', 'Completed'] as const;
export type OrderFilterOption = typeof ORDER_FILTER_OPTIONS[number];

/**
 * Get Tailwind classes for a status badge (bg + text + border).
 * Useful for components that want a bordered badge appearance.
 */
export function getStatusBadgeClasses(status: string): string {
    const normalized = status?.toLowerCase().trim() || 'pending';
    const badgeStyles: Record<string, string> = {
        completed: 'bg-green-100 text-green-700 border-green-200',
        processing: 'bg-blue-100 text-blue-700 border-blue-200',
        'on-hold': 'bg-yellow-100 text-yellow-700 border-yellow-200',
        pending: 'bg-gray-100 text-gray-600 border-gray-200',
        cancelled: 'bg-red-100 text-red-700 border-red-200',
        refunded: 'bg-purple-100 text-purple-700 border-purple-200',
        shipped: 'bg-purple-100 text-purple-700 border-purple-200',
        failed: 'bg-red-100 text-red-700 border-red-200',
    };
    return badgeStyles[normalized] || 'bg-gray-100 text-gray-600 border-gray-200';
}
