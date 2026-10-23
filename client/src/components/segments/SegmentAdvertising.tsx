import { useEffect, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useToast } from '../../context/ToastContext';

export interface AudienceSync {
    id: string;
    platform: string;
    audienceName: string;
    status: string;
    lastSyncAt: string | null;
    lastError: string | null;
    memberCount: number | null;
    autoSyncEnabled: boolean;
    includeSubscribers?: boolean;
    enhancedMatching?: boolean;
}

interface Destination { id: string; name: string | null; platform: string; externalId: string | null }

export function SegmentAdvertising({ segment, onRefresh }: {
    segment: { id: string; name: string; audienceSyncs?: AudienceSync[] };
    onRefresh: () => Promise<void>;
}) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();
    const [destinations, setDestinations] = useState<Destination[]>([]);
    const [destinationId, setDestinationId] = useState('');
    const [consent, setConsent] = useState(false);
    const [includeSubscribers, setIncludeSubscribers] = useState(false);
    const [enhancedMatching, setEnhancedMatching] = useState(false);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const headers = { Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount?.id || '', 'Content-Type': 'application/json' };

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch('/api/segments/destinations', { headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount?.id || '' } })
            .then(async response => {
                if (!response.ok) throw new Error('Could not load advertising accounts');
                const data = await response.json();
                if (!cancelled) setDestinations(data);
            }).catch(() => { if (!cancelled) toast.error('Could not load advertising accounts'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [token, currentAccount?.id, toast]);

    async function mutate(path: string, method: string, body: unknown) {
        setBusy(true);
        try {
            const response = await fetch(`/api/segments/${segment.id}/${path}`, { method, headers, body: JSON.stringify(body) });
            if (!response.ok) throw new Error((await response.json()).error || 'Could not update audience');
            await onRefresh();
            toast.success('Audience updated. Enabled audiences sync now and every 5 minutes.');
        } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update audience'); }
        finally { setBusy(false); }
    }

    async function download(platform: string) {
        setBusy(true);
        try {
            const response = await fetch(`/api/segments/${segment.id}/ad-export?platform=${platform}`, { headers });
            if (!response.ok) throw new Error('Could not export audience');
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.href = url;
            link.download = `audience-${platform.toLowerCase()}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        } catch { toast.error('Could not export audience'); }
        finally { setBusy(false); }
    }

    return <div className="space-y-5 text-sm text-slate-700 dark:text-slate-200">
        <p>Keep <strong>{segment.name}</strong> up to date in Meta Custom Audiences or Google Customer Match. Membership is refreshed every 5 minutes as the rules change. Platforms may take longer to process updates.</p>
        <p>Email-only matching is the default. Optional enhanced matching includes hashed phone/name and platform-required country/postal codes when available. Platform terms, account eligibility and minimum audience sizes still apply. Counts below are submitted profiles, not matched or reachable people.</p>
        {(destinations.find(destination => destination.id === destinationId)?.platform === 'GOOGLE' || segment.audienceSyncs?.some(sync => sync.platform === 'GOOGLE')) && <p className="rounded-lg bg-[var(--brand-subtle)] p-3 text-[var(--brand-text)]">Google customer lists use the Data Manager API. Enable it in the OAuth client’s Google Cloud project, then reconnect Google Ads in Settings to grant the new permission. Accepted uploads remain Processing until Google confirms completion; this can take longer than the five-minute sync interval.</p>}
        <label className="flex items-start gap-2"><input type="checkbox" checked={includeSubscribers} onChange={event => { setIncludeSubscribers(event.target.checked); setConsent(false); }} /><span>Also include subscribed members of active email lists who match these rules, even without a customer record. This only expands advertising audiences, not customer previews or broadcasts. Email subscription alone is not advertising consent.</span></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={enhancedMatching} onChange={event => { setEnhancedMatching(event.target.checked); setConsent(false); }} /><span>Enable enhanced matching using available phone, name and address identifiers.</span></label>
        <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1" />
            <span>I confirm all current and future members of this segment have the required consent for advertising data sharing and personalised ads, and our business has accepted the platform customer-data terms.</span>
        </label>
        {loading ? <p>Loading connected accounts…</p> : destinations.length === 0 ? <p>Connect a Meta or Google Ads account in Settings first.</p> : <div className="flex flex-col gap-2 sm:flex-row">
            <select aria-label="Advertising destination" value={destinationId} onChange={event => setDestinationId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white p-2 dark:bg-slate-800">
                <option value="">Select advertising account</option>
                {destinations.map(destination => <option key={destination.id} value={destination.id}>{destination.platform} · {destination.name || destination.externalId}</option>)}
            </select>
            <button disabled={busy || !consent || !destinationId} onClick={() => void mutate('audiences', 'POST', { adAccountId: destinationId, consentConfirmed: consent, includeSubscribers, enhancedMatching })} className="rounded-lg bg-[var(--primary-color)] px-4 py-2 text-[var(--primary-foreground)] disabled:opacity-50">Enable / update sync</button>
        </div>}
        <div className="space-y-3">
            {(segment.audienceSyncs || []).map(sync => <div key={sync.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p className="font-medium">{sync.platform} · {sync.audienceName}</p>
                <p>{sync.includeSubscribers ? 'Customers + eligible list subscribers' : 'Customers only'} · {sync.enhancedMatching ? 'Enhanced matching' : 'Email matching'}</p>
                <p className="mt-1">{sync.autoSyncEnabled ? sync.status : 'PAUSED'} · {sync.memberCount ?? 0} identifiers · Last sync: {sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : 'Not yet'}</p>
                {sync.platform === 'GOOGLE' && sync.status === 'PROCESSING' && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Waiting for Google Data Manager processing. Overseek will check the request again automatically.</p>}
                {sync.lastError && <p className="mt-2 text-red-600 dark:text-red-400">{sync.lastError}</p>}
                <div className="mt-2 flex flex-wrap gap-4">
                    {sync.status === 'FAILED' && sync.autoSyncEnabled && <button disabled={busy} onClick={() => void mutate(`audiences/${sync.id}`, 'PATCH', { enabled: true })} className="font-medium text-[var(--brand-text)] disabled:opacity-50">Retry sync</button>}
                    <button disabled={busy || (!sync.autoSyncEnabled && !consent)} onClick={() => void mutate(`audiences/${sync.id}`, 'PATCH', { enabled: !sync.autoSyncEnabled })} className="font-medium text-[var(--brand-text)] disabled:opacity-50">{sync.autoSyncEnabled ? 'Pause sync' : 'Resume sync'}</button>
                </div>
            </div>)}
        </div>
        <p className="text-xs">Pausing stops updates but leaves the existing platform audience intact. Deleting a segment also stops syncing; remove its audience in the ad platform if no longer needed.</p>
        <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            {['META', 'GOOGLE'].map(platform => <button key={platform} disabled={busy || !consent} onClick={() => void download(platform)} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50"><Download size={16} />{platform} CSV</button>)}
            <button disabled={busy} onClick={() => void onRefresh()} className="flex items-center gap-2 px-3 py-2"><RefreshCw size={16} />Refresh status</button>
            {busy && <Loader2 className="animate-spin" size={18} />}
        </div>
        <p className="text-xs">CSV exports are a one-time customer-email snapshot. They do not include subscriber expansion or enhanced identifiers.</p>
    </div>;
}
