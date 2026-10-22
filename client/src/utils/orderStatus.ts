import { Clock, Package, Truck, CheckCircle, XCircle, RefreshCw, AlertCircle, type LucideIcon } from 'lucide-react';

interface StatusConfig { icon: LucideIcon; color: string; bg: string; label: string }
/** Display metadata only. Allowed transitions must come from the store, not a guessed workflow. */
const ORDER_STATUS_CONFIG: Record<string, StatusConfig> = {
    pending: { icon: Clock, color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-950', label: 'Pending' },
    processing: { icon: Package, color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-100 dark:bg-blue-950', label: 'Processing' },
    'on-hold': { icon: AlertCircle, color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-100 dark:bg-orange-950', label: 'On Hold' },
    shipped: { icon: Truck, color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-100 dark:bg-purple-950', label: 'Shipped' },
    delivered: { icon: CheckCircle, color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-950', label: 'Delivered' },
    completed: { icon: CheckCircle, color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-950', label: 'Completed' },
    cancelled: { icon: XCircle, color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-950', label: 'Cancelled' },
    refunded: { icon: RefreshCw, color: 'text-slate-700 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800', label: 'Refunded' },
    failed: { icon: XCircle, color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-950', label: 'Failed' },
};
const UNKNOWN: StatusConfig = { icon: Clock, color: 'text-slate-700 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800', label: 'Unknown' };
export function getStatusConfig(status: unknown): StatusConfig {
    const normalized = typeof status === 'string' ? status.trim().toLowerCase().replace(/^wc-/, '') : '';
    return { ...(Object.prototype.hasOwnProperty.call(ORDER_STATUS_CONFIG, normalized) ? ORDER_STATUS_CONFIG[normalized] : UNKNOWN) };
}
export function getStatusColor(status: unknown): string {
    const config = getStatusConfig(status); return `${config.bg} ${config.color}`;
}
export function getStatusBadgeClasses(status: unknown): string {
    return `${getStatusColor(status)} border-current/20`;
}
