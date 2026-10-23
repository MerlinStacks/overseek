import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useToast } from '../../context/ToastContext';

export interface AdAudienceDestination { id: string; name: string | null; platform: string; externalId: string | null }
interface Sources {
    pixels: { id: string; name: string }[];
    lookalikeSources: { id: string; type: 'CUSTOMER_LIST' | 'WEBSITE'; name: string; autoSyncEnabled?: boolean }[];
}

const COUNTRIES = [
    ['AU', 'Australia'], ['NZ', 'New Zealand'], ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'],
    ['IE', 'Ireland'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'],
    ['BE', 'Belgium'], ['AT', 'Austria'], ['CH', 'Switzerland'], ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'],
    ['FI', 'Finland'], ['SG', 'Singapore'], ['JP', 'Japan']
];
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

export function NativeAudienceForm({ destinations, onCreated, onCancel, initialKind = 'WEBSITE', asSegment = false }: {
    destinations: AdAudienceDestination[];
    onCreated: () => void;
    onCancel: () => void;
    initialKind?: 'WEBSITE' | 'LOOKALIKE';
    asSegment?: boolean;
}) {
    const api = useApi();
    const toast = useToast();
    const [adAccountId, setAdAccountId] = useState('');
    const [kind, setKind] = useState<string>(initialKind);
    const [name, setName] = useState('');
    const [pixelId, setPixelId] = useState('');
    const [event, setEvent] = useState('PageView');
    const [urlContains, setUrlContains] = useState('');
    const [retentionDays, setRetentionDays] = useState('30');
    const [excludePurchasers, setExcludePurchasers] = useState(false);
    const [exclusionDays, setExclusionDays] = useState('30');
    const [purchaseUrlContains, setPurchaseUrlContains] = useState('/order-received/');
    const [tagConfirmed, setTagConfirmed] = useState(false);
    const [consentConfirmed, setConsentConfirmed] = useState(false);
    const [source, setSource] = useState('');
    const [country, setCountry] = useState('AU');
    const [percent, setPercent] = useState('1');
    const [busy, setBusy] = useState(false);
    const destination = destinations.find(item => item.id === adAccountId);
    const meta = destination?.platform === 'META';
    const { data: sources, isLoading: loadingSources, error: sourceError } = useApiQuery<Sources>({
        queryKey: ['native-ad-audience-sources', api.accountId, adAccountId],
        queryFn: () => api.get(`/api/segments/native-audiences/sources/${encodeURIComponent(adAccountId)}`),
        enabled: api.isReady && Boolean(adAccountId), staleTime: 30000
    });
    const maxDays = meta ? 180 : 540;
    const daysValid = (value: string) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= maxDays;
    const selectedSource = sources?.lookalikeSources.find(item => `${item.type}:${item.id}` === source);
    const validWebsite = daysValid(retentionDays) && daysValid(exclusionDays)
        && (meta ? Boolean(pixelId && sources?.pixels.some(pixel => pixel.id === pixelId)) : tagConfirmed && urlContains.trim().length >= 2)
        && (!excludePurchasers || meta || purchaseUrlContains.trim().length >= 2);
    const valid = Boolean(destination && name.trim() && consentConfirmed && !sourceError
        && (kind === 'WEBSITE' ? validWebsite : meta && selectedSource));

    function preset(label: string, nextEvent: string, path: string, exclude: boolean, days: string) {
        setName(label);
        setEvent(nextEvent);
        setUrlContains(meta ? '' : path);
        setExcludePurchasers(exclude);
        setRetentionDays(days);
    }

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        try {
            const definition = kind === 'WEBSITE' ? {
                ...(meta ? { pixelId, event } : { tagConfirmed, purchaseUrlContains }),
                urlContains, retentionDays: Number(retentionDays), excludePurchasers, exclusionDays: Number(exclusionDays)
            } : { sourceType: selectedSource!.type, sourceId: selectedSource!.id, country, percent: Number(percent) };
            const result = await api.post<{ status: string }>('/api/segments/native-audiences', { adAccountId, kind, name: name.trim(), consentConfirmed, definition });
            toast.success(result.status === 'CREATED' ? 'This audience already exists in Overseek' : asSegment ? 'Segment saved. Check its platform creation status in Segments.' : 'Audience request saved. Check its creation status below.');
            onCreated();
        } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create audience'); }
        finally { setBusy(false); }
    }

    return <form onSubmit={submit} className="space-y-5 text-sm text-slate-700 dark:text-slate-200">
        <fieldset disabled={busy} className="space-y-4 disabled:opacity-70">
            <label className="block font-medium">Advertising account
                <select className={inputClass} value={adAccountId} onChange={e => {
                    setAdAccountId(e.target.value); setPixelId(''); setSource(''); setKind(initialKind === 'LOOKALIKE' && destinations.find(item => item.id === e.target.value)?.platform === 'META' ? 'LOOKALIKE' : 'WEBSITE'); setTagConfirmed(false); setConsentConfirmed(false);
                }}>
                    <option value="">Choose a connected account</option>
                    {destinations.map(item => <option key={item.id} value={item.id}>{item.platform} · {item.name || item.externalId}</option>)}
                </select>
            </label>
            {destination && <>
                <label className="block font-medium">{asSegment ? 'Segment type' : 'Audience type'}
                    <select className={inputClass} value={kind} onChange={e => setKind(e.target.value)}>
                        <option value="WEBSITE">Website retargeting</option>
                        {meta && <option value="LOOKALIKE">Meta lookalike</option>}
                    </select>
                </label>
                <label className="block font-medium">{asSegment ? 'Segment name' : 'Audience name'}
                    <input required maxLength={200} className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Checkout visitors · 14 days" />
                </label>
                {loadingSources && <p>Loading accessible sources…</p>}
                {sourceError && <p role="alert" className="text-red-600 dark:text-red-400">{sourceError.message}</p>}
                {kind === 'WEBSITE' ? <>
                    <div className="flex flex-wrap gap-2" aria-label="Website audience presets">
                        <button type="button" className="rounded-lg border border-slate-300 px-3 py-2" onClick={() => preset('Website visitors · 30 days', 'PageView', '', false, '30')}>All visitors</button>
                        <button type="button" className="rounded-lg border border-slate-300 px-3 py-2" onClick={() => preset('Product viewers excluding purchasers · 30 days', 'ViewContent', '/product/', true, '30')}>Product viewers</button>
                        <button type="button" className="rounded-lg border border-slate-300 px-3 py-2" onClick={() => preset(meta ? 'Cart additions excluding purchasers · 14 days' : 'Cart-page visitors excluding purchasers · 14 days', 'AddToCart', '/cart/', true, '14')}>{meta ? 'Cart additions' : 'Cart-page visitors'}</button>
                        <button type="button" className="rounded-lg border border-slate-300 px-3 py-2" onClick={() => preset('Checkout visitors excluding purchasers · 14 days', 'InitiateCheckout', '/checkout/', true, '14')}>Checkout visitors</button>
                    </div>
                    {meta ? <>
                        <label className="block font-medium">Meta pixel / dataset
                            <select className={inputClass} value={pixelId} onChange={e => setPixelId(e.target.value)}>
                                <option value="">Select an accessible pixel</option>
                                {sources?.pixels.map(pixel => <option key={pixel.id} value={pixel.id}>{pixel.name} · {pixel.id}</option>)}
                            </select>
                        </label>
                        {sources && sources.pixels.length === 0 && <p>No accessible pixels. Assign the website pixel/dataset to this advertising account in Meta first.</p>}
                        <label className="block font-medium">Website event
                            <select className={inputClass} value={event} onChange={e => { setEvent(e.target.value); if (e.target.value === 'Purchase') setExcludePurchasers(false); }}>
                                {[['PageView', 'Page view'], ['ViewContent', 'Product view'], ['AddToCart', 'Add to cart'], ['InitiateCheckout', 'Start checkout'], ['Purchase', 'Purchase']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                        </label>
                    </> : <p className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100">Google uses URL-based visitor rules here. Cart-page visits are not proof of adding to cart. Verify your actual product, cart, checkout and confirmation paths; presets are examples.</p>}
                    <label className="block font-medium">{meta ? 'URL contains (optional)' : 'Visited URL contains'}
                        <input className={inputClass} maxLength={500} value={urlContains} onChange={e => setUrlContains(e.target.value)} placeholder={meta ? '/product-category/gifts/' : 'store.example.com or /checkout/'} />
                    </label>
                    <label className="block font-medium">Membership window (days)
                        <input className={inputClass} type="number" min={1} max={maxDays} step={1} value={retentionDays} onChange={e => setRetentionDays(e.target.value)} />
                    </label>
                    <label className="flex items-start gap-2">
                        <input type="checkbox" className="mt-1" checked={excludePurchasers} disabled={meta && event === 'Purchase'} onChange={e => setExcludePurchasers(e.target.checked)} />Exclude purchasers within a separate rolling window
                    </label>
                    {excludePurchasers && <>
                        <label className="block font-medium">Purchaser exclusion window (days)
                            <input className={inputClass} type="number" min={1} max={maxDays} step={1} value={exclusionDays} onChange={e => setExclusionDays(e.target.value)} />
                        </label>
                        {!meta && <label className="block font-medium">Order-confirmation URL contains
                            <input className={inputClass} value={purchaseUrlContains} maxLength={500} onChange={e => setPurchaseUrlContains(e.target.value)} />
                        </label>}
                    </>}
                    <p className="text-xs">Exclusions apply to anyone with a matching purchase{!meta && ' confirmation-page visit'} in that window, regardless of event order. These are retargeting rules, not a strict abandoned-cart calculation.</p>
                    {!meta && <label className="flex items-start gap-2 rounded-lg border border-slate-300 p-3">
                        <input type="checkbox" className="mt-1" checked={tagConfirmed} onChange={e => setTagConfirmed(e.target.checked)} />
                        <span>I have verified the Google remarketing tag for this advertising account is active on these pages and advertising personalisation is enabled where consent permits. Enhanced conversions alone are not sufficient.</span>
                    </label>}
                </> : <>
                    <label className="block font-medium">Source audience
                        <select className={inputClass} value={source} onChange={e => setSource(e.target.value)}>
                            <option value="">Choose a managed Meta source</option>
                            {sources?.lookalikeSources.map(item => <option key={`${item.type}:${item.id}`} value={`${item.type}:${item.id}`}>{item.name}{item.type === 'CUSTOMER_LIST' && !item.autoSyncEnabled ? ' (uploads paused)' : ''}</option>)}
                        </select>
                    </label>
                    {sources && sources.lookalikeSources.length === 0 && <p>Create a website audience or successfully sync a segment to this Meta account first.</p>}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block font-medium">Target country
                            <select className={inputClass} value={country} onChange={e => setCountry(e.target.value)}>{COUNTRIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>
                        </label>
                        <label className="block font-medium">Lookalike size
                            <select className={inputClass} value={percent} onChange={e => setPercent(e.target.value)}>{['1', '3', '5'].map(value => <option key={value} value={value}>{value}%</option>)}</select>
                        </label>
                    </div>
                    <p>Meta maintains the lookalike from its source. Source size, country coverage and account eligibility determine whether it can be created and used. Keep customer-list sources syncing for fresh seed data.</p>
                </>}
            </>}
            <label className="flex items-start gap-2 rounded-lg border border-slate-300 p-3">
                <input type="checkbox" className="mt-1" checked={consentConfirmed} onChange={e => setConsentConfirmed(e.target.checked)} />
                <span>I confirm we have the required advertising consent and permissions, have accepted the platform audience terms, and the chosen tracking source respects consent.</span>
            </label>
        </fieldset>
        <p className="text-xs">This creates an audience definition only. Membership refreshes within the platform; campaigns and budgets are not changed. Availability can take time and minimum sizes apply.</p>
        <div className="flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg px-4 py-2">Cancel</button>
            <button type="submit" disabled={busy || !valid} className="flex items-center gap-2 rounded-lg bg-[var(--primary-color)] px-4 py-2 text-[var(--primary-foreground)] disabled:opacity-50">{busy && <Loader2 size={16} className="animate-spin" />}{asSegment ? 'Create segment' : 'Create audience'}</button>
        </div>
    </form>;
}
