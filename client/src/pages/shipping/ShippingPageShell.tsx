import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useApiQuery } from '../../hooks/useApiQuery';
import { shippingFetch, type ShippingSettingsResponse } from './shippingApi';

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
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
                    <p className="mt-0.5 max-w-3xl text-sm text-slate-500 dark:text-slate-400">{description}</p>
                </div>
                <Link
                    to="/shipping/settings"
                    className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-300"
                    title={checkpointHelp}
                >
                    {checkpointLabel}
                </Link>
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
