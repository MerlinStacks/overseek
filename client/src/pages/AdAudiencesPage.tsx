import { useState } from 'react';
import { Globe, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useApiQuery } from '../hooks/useApiQuery';
import { useToast } from '../context/ToastContext';
import { Modal } from '../components/ui/Modal';
import { NativeAudienceForm, type AdAudienceDestination } from '../components/segments/NativeAudienceForm';

interface NativeAudience {
    id: string;
    name: string;
    kind: string;
    platform: string;
    status: string;
    externalId: string | null;
    lastError: string | null;
    definition: { retentionDays?: number; exclusionDays?: number; excludePurchasers?: boolean; event?: string; urlContains?: string; country?: string; percent?: number };
    adAccount: { name: string | null };
}

export function AdAudiencesPage() {
    const api = useApi();
    const toast = useToast();
    const [creating, setCreating] = useState(false);
    const [retrying, setRetrying] = useState<string | null>(null);
    const { data, isLoading, error, refetch } = useApiQuery<{ audiences: NativeAudience[]; destinations: AdAudienceDestination[] }>({
        queryKey: ['native-ad-audiences', api.accountId],
        queryFn: async () => {
            const [audiences, destinations] = await Promise.all([
                api.get<NativeAudience[]>('/api/segments/native-audiences'),
                api.get<AdAudienceDestination[]>('/api/segments/destinations')
            ]);
            return { audiences, destinations };
        },
        enabled: api.isReady, refetchInterval: 15000
    });

    async function retry(id: string) {
        if (!window.confirm('Retry audience creation? This reconfirms that the required advertising consent and platform audience terms remain satisfied.')) return;
        setRetrying(id);
        try {
            await api.post(`/api/segments/native-audiences/${id}/retry`, { consentConfirmed: true });
            await refetch();
            toast.success('Audience creation queued again');
        } catch (failure) { toast.error(failure instanceof Error ? failure.message : 'Could not retry creation'); }
        finally { setRetrying(null); }
    }

    async function reconcile(id: string) {
        setRetrying(id);
        try {
            await api.post(`/api/segments/native-audiences/${id}/reconcile`);
            await refetch();
            toast.success('Platform audience found and linked');
        } catch (failure) { toast.error(failure instanceof Error ? failure.message : 'Could not check the platform'); }
        finally { setRetrying(null); }
    }

    return <div className="space-y-6 text-slate-700 dark:text-slate-200">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Website audiences & lookalikes</h2>
                <p className="mt-1 text-sm">Create platform-managed Meta and Google website audiences, or Meta lookalikes from your best customers.</p>
            </div>
            <div className="flex shrink-0 gap-2">
                <button onClick={() => void refetch()} className="rounded-lg border border-slate-300 p-2" aria-label="Refresh audience status"><RefreshCw size={18} /></button>
                <button onClick={() => setCreating(true)} disabled={!data?.destinations.length} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Plus size={18} />Create audience</button>
            </div>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-100">
            <p>Website membership and lookalikes update inside the advertising platform, not through hourly email uploads. These audiences can include consented visitors who have never become an Overseek contact.</p>
            <p className="mt-2">Meta uses pixel events. Google uses URL rules and requires its remarketing tag; enhanced-conversion uploads alone do not populate these lists. Google Demand Gen lookalikes and campaign expansion are not configured here.</p>
        </div>
        {isLoading && <p className="flex items-center gap-2 text-sm"><Loader2 size={18} className="animate-spin" />Loading advertising audiences…</p>}
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error.message}</p>}
        {data && data.destinations.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center">Connect a Meta or Google Ads account in Settings to get started.</p>}
        {data && data.destinations.length > 0 && data.audiences.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
            <Globe size={36} className="mx-auto mb-3 text-indigo-500" />
            <p className="font-medium">Build your first website audience</p>
            <p className="mt-1 text-sm">Start with product viewers or checkout visitors excluding recent purchasers.</p>
        </div>}
        <div className="grid gap-4 md:grid-cols-2">
            {data?.audiences.map(audience => <div key={audience.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-slate-900 dark:text-white">{audience.name}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium dark:bg-slate-700">{audience.status === 'CREATED' ? 'Created · platform managed' : audience.status.replace(/_/g, ' ')}</span>
                </div>
                <p className="text-sm">{audience.platform} · {audience.adAccount.name || 'Advertising account'} · {audience.kind === 'LOOKALIKE' ? 'Lookalike' : 'Website retargeting'}</p>
                <p className="text-sm">{audience.kind === 'LOOKALIKE'
                    ? `${audience.definition.country} · ${audience.definition.percent}% · platform-maintained source expansion`
                    : `${audience.definition.event || 'URL contains'}${audience.definition.urlContains ? ` · ${audience.definition.urlContains}` : ''} · ${audience.definition.retentionDays} days${audience.definition.excludePurchasers ? ` · excluding purchasers (${audience.definition.exclusionDays} days)` : ''}`}</p>
                {audience.externalId && <p className="break-all text-xs text-slate-500 dark:text-slate-400">Platform ID: {audience.externalId}</p>}
                {audience.lastError && <p className="text-sm text-red-600 dark:text-red-400">{audience.lastError}</p>}
                {audience.status === 'FAILED' && <button onClick={() => void retry(audience.id)} disabled={retrying !== null} className="text-sm font-medium text-indigo-600 dark:text-indigo-300">{retrying === audience.id ? 'Queueing…' : 'Retry creation'}</button>}
                {audience.status === 'NEEDS_REVIEW' && <button onClick={() => void reconcile(audience.id)} disabled={retrying !== null} className="text-sm font-medium text-indigo-600 dark:text-indigo-300">{retrying === audience.id ? 'Checking…' : 'Check platform result'}</button>}
                {audience.status === 'CREATED' && <p className="text-xs text-slate-500 dark:text-slate-400">Definition created, not a guarantee of eligibility or audience size. Check the platform and attach it to a campaign when ready.</p>}
            </div>)}
        </div>
        {data?.audiences.length === 200 && <p className="text-xs">Showing the 200 most recent definitions. Additional audiences remain in the platform.</p>}
        <Modal isOpen={creating} onClose={() => setCreating(false)} title="Create advertising audience" maxWidth="max-w-2xl">
            {creating && <NativeAudienceForm key={api.accountId} destinations={data?.destinations || []} onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); void refetch(); }} />}
        </Modal>
    </div>;
}
