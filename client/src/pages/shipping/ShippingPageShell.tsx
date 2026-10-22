import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useShippingRead } from './shippingWorkspace';
function decode(value: unknown) { return z.object({ accountId: z.string(), carrierAccount: z.object({ config: z.record(z.string(), z.unknown()).nullish() }).nullable() }).parse(value); }
export function ShippingPageShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    const { token, user } = useAuth(), { currentAccount } = useAccount();
    return <div className="space-y-6 text-slate-900 dark:text-slate-100"><header><h1 className="text-2xl font-semibold">{title}</h1><p>{description}</p>{token && user?.id && currentAccount ? <Policy key={JSON.stringify([user.id, token, currentAccount.id])} token={token} accountId={currentAccount.id} /> : <p>Fulfillment policy unavailable.</p>}</header>{children}</div>;
}
function Policy({ token, accountId }: { token: string; accountId: string }) {
    const read = useShippingRead('/workspace/policy', { token, accountId, actorId: '' }, decode), { hasPermission } = usePermissions();
    const value = read.data?.accountId === accountId && !read.error ? read.data.carrierAccount?.config?.wooFulfillmentBehavior : undefined;
    const labels: Record<string, string> = { keep_in_dispatch: 'Reported policy: keep in dispatch', label_created: 'Reported policy: complete after label creation and acknowledged Woo sync', print_success: 'Reported policy: complete after recorded print success and acknowledged Woo sync' };
    const label = read.loading || read.error || !read.data || read.data.accountId !== accountId ? 'Fulfillment policy unavailable.' : value === undefined || value === null ? 'No explicit checkpoint observed; server default is keep in dispatch.' : typeof value === 'string' && Object.prototype.hasOwnProperty.call(labels, value) ? labels[value] : 'Unknown fulfillment policy; no completion checkpoint asserted.';
    return <div className="space-y-1 text-sm"><p>{label} Policy is not evidence that a label printed or an order completed.</p>{hasPermission('manage_shipping_settings') && <Link to="/shipping/settings">Review shipping settings</Link>}</div>;
}
export function ShippingComingSoonCard({ children }: { children: ReactNode }) { return <section className="rounded-xl border bg-white p-4 dark:bg-slate-800">{children}</section>; }
