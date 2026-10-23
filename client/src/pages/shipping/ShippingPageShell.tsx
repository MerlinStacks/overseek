import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useShippingRead } from './shippingWorkspace';
import { Truck } from 'lucide-react';
import { DataNote } from '../../components/ui/DataNote';
import { workspaceStyles as ui } from '../../components/ui/workspaceStyles';
function decode(value: unknown) { return z.object({ accountId: z.string(), carrierAccount: z.object({ config: z.record(z.string(), z.unknown()).nullish() }).nullable() }).parse(value); }
export function ShippingPageShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    const { token, user } = useAuth(), { currentAccount } = useAccount();
    return <div className="min-w-0 space-y-6 text-slate-900 dark:text-slate-100"><header className="space-y-4"><div className="flex items-center gap-3"><span className="rounded-xl bg-indigo-50 p-3 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"><Truck size={24} /></span><div><p className="text-xs font-medium text-slate-500 dark:text-slate-400">Shipping workspace</p><h1 className="text-2xl font-semibold">{title}</h1></div></div><DataNote title="Workspace scope and safeguards">{description}</DataNote>{token && user?.id && currentAccount ? <Policy key={JSON.stringify([user.id, token, currentAccount.id])} token={token} accountId={currentAccount.id} /> : <p className={ui.muted}>Fulfillment policy unavailable.</p>}</header>{children}</div>;
}
function Policy({ token, accountId }: { token: string; accountId: string }) {
    const read = useShippingRead('/workspace/policy', { token, accountId, actorId: '' }, decode), { hasPermission } = usePermissions();
    const value = read.data?.accountId === accountId && !read.error ? read.data.carrierAccount?.config?.wooFulfillmentBehavior : undefined;
    const labels: Record<string, string> = { keep_in_dispatch: 'Reported policy: keep in dispatch', label_created: 'Reported policy: complete after label creation and acknowledged Woo sync', print_success: 'Reported policy: complete after recorded print success and acknowledged Woo sync' };
    const label = read.loading || read.error || !read.data || read.data.accountId !== accountId ? 'Fulfillment policy unavailable.' : value === undefined || value === null ? 'No explicit checkpoint observed; server default is keep in dispatch.' : typeof value === 'string' && Object.prototype.hasOwnProperty.call(labels, value) ? labels[value] : 'Unknown fulfillment policy; no completion checkpoint asserted.';
    return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800"><p className={ui.muted}>{label}<span className="mt-1 block">Policy is not evidence that a label printed or an order completed.</span></p>{hasPermission('manage_shipping_settings') && <Link className={ui.link} to="/shipping/settings">Review shipping settings</Link>}</div>;
}
export function ShippingComingSoonCard({ children }: { children: ReactNode }) { return <section className="rounded-xl border bg-white p-4 dark:bg-slate-800">{children}</section>; }
