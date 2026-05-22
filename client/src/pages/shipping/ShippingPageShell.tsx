import { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Truck } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useApiQuery } from '../../hooks/useApiQuery';
import { shippingFetch, type ShippingSettingsResponse } from './shippingApi';

const tabs = [
    { label: 'Hub', path: '/shipping' },
    { label: 'Packages', path: '/shipping/packages' },
    { label: 'Item Overwrites', path: '/shipping/item-overwrites' },
    { label: 'Past Labels / Invoices', path: '/shipping/labels' },
    { label: 'Operations', path: '/shipping/operations' },
    { label: 'Settings', path: '/shipping/settings' },
];

interface ShippingPageShellProps {
    title: string;
    description: string;
    children: ReactNode;
}

export function ShippingPageShell({ title, description, children }: ShippingPageShellProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const canFetch = Boolean(token && currentAccount?.id);
    const settingsQuery = useApiQuery<ShippingSettingsResponse>({
        queryKey: ['shipping-settings', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/settings', token!, currentAccount!.id),
    });
    const behavior = String(settingsQuery.data?.carrierAccount?.config?.wooFulfillmentBehavior || 'print_success');
    const checkpointLabel = behavior === 'label_created'
        ? 'Checkpoint: label created'
        : behavior === 'keep_in_dispatch'
            ? 'Checkpoint: keep in dispatch'
            : 'Checkpoint: print success';
    const checkpointHelp = behavior === 'label_created'
        ? 'Orders are marked completed when labels are created.'
        : behavior === 'keep_in_dispatch'
            ? 'Orders stay in dispatch until completed manually.'
            : 'Orders are marked completed after successful print + Woo sync.';

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-indigo-600 p-3 text-white shadow-lg shadow-indigo-600/20">
                            <Truck size={24} />
                        </div>
                        <div>
                            <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Shipping</p>
                            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{title}</h1>
                        </div>
                    </div>
                    <p className="mt-3 max-w-3xl text-sm text-slate-600 dark:text-slate-300">{description}</p>
                    <div className="mt-3">
                        <Link
                            to="/shipping/settings"
                            className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-300"
                            title={checkpointHelp}
                        >
                            {checkpointLabel}
                        </Link>
                    </div>
                </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white/80 p-1.5 shadow-sm backdrop-blur-lg dark:border-slate-700/60 dark:bg-slate-800/80">
                <nav className="flex min-w-max gap-1">
                    {tabs.map((tab) => (
                        <NavLink
                            key={tab.path}
                            to={tab.path}
                            end={tab.path === '/shipping'}
                            className={({ isActive }) => cn(
                                'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                                isActive
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/70'
                            )}
                        >
                            {tab.label}
                        </NavLink>
                    ))}
                </nav>
            </div>

            {children}
        </div>
    );
}

export function ShippingComingSoonCard({ children }: { children: ReactNode }) {
    return (
        <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-6 shadow-lg backdrop-blur-lg dark:border-slate-700/60 dark:bg-slate-800/80">
            {children}
        </div>
    );
}
