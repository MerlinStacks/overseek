import { useEffect, useMemo, useState } from 'react';
import { Check, Image, Loader2, Palette, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Logger } from '../../utils/logger';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useApi } from '../../hooks/useApi';
import { useAccountFeature } from '../../hooks/useAccountFeature';
import { usePermissions } from '../../hooks/usePermissions';
import { createWholesaleCatalogService } from '../../services/wholesaleCatalogService';
import type { WholesaleBranding, WholesaleBrandingImportCandidates } from '../../types/wholesaleCatalog';
import { applyBrandingCandidate, applyBrandingCandidates, type BrandingCandidateKind } from '../wholesale/wholesaleEditorHelpers';
import { WholesaleBrandingSettings } from './WholesaleBrandingSettings';

const DEFAULT_COLOR = '#2563eb';
const EMPTY_WHOLESALE: WholesaleBranding = { logoUrl: null, primaryColor: null, accentColor: null, headingFont: null, bodyFont: null, businessDetails: {} };
const defaultSocialLinks = () => [{ label: 'Facebook', href: '' }, { label: 'Instagram', href: '' }, { label: 'TikTok', href: '' }];
const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

export function AppearanceSettings() {
    const { currentAccount, refreshAccounts } = useAccount();
    const { token } = useAuth();
    const api = useApi();
    const service = useMemo(() => createWholesaleCatalogService(api), [api]);
    const toast = useToast();
    const wholesaleEnabled = useAccountFeature('WHOLESALE_CATALOG');
    const { hasPermission } = usePermissions();
    const canViewWholesale = wholesaleEnabled && hasPermission('view_wholesale_catalog');
    const canEditWholesale = canViewWholesale && hasPermission('edit_wholesale_catalog');
    const canEditAppearance = hasPermission('*');
    const [settings, setSettings] = useState({ appName: 'OverSeek', primaryColor: DEFAULT_COLOR, logoUrl: '', socialLinks: defaultSocialLinks() });
    const [wholesale, setWholesale] = useState<WholesaleBranding>(EMPTY_WHOLESALE);
    const [loadingWholesale, setLoadingWholesale] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [importing, setImporting] = useState(false);
    const [candidates, setCandidates] = useState<WholesaleBrandingImportCandidates | null>(null);
    const [sources, setSources] = useState<string[]>([]);
    const [importWarning, setImportWarning] = useState('');
    const [logoPreviewFailed, setLogoPreviewFailed] = useState(false);

    useEffect(() => {
        const appearance = currentAccount?.appearance;
        setSettings({
            appName: appearance?.appName || currentAccount?.name || 'OverSeek',
            primaryColor: appearance?.primaryColor || DEFAULT_COLOR,
            logoUrl: appearance?.logoUrl || '',
            socialLinks: appearance?.socialLinks?.length ? appearance.socialLinks : defaultSocialLinks(),
        });
    }, [currentAccount]);

    useEffect(() => {
        if (!api.isReady || !canViewWholesale) return;
        setLoadingWholesale(true);
        service.getBranding().then(result => {
            setWholesale(result.branding);
            setSettings(current => ({
                ...current,
                appName: currentAccount?.appearance?.appName || String(result.branding.businessDetails.name || current.appName),
                logoUrl: currentAccount?.appearance?.logoUrl || result.branding.logoUrl || current.logoUrl,
                primaryColor: currentAccount?.appearance?.primaryColor || result.branding.primaryColor || current.primaryColor,
            }));
        }).catch((reason: Error) => toast.error(reason.message)).finally(() => setLoadingWholesale(false));
    }, [api.isReady, canViewWholesale, currentAccount, service, toast]);

    const fillFromAccount = () => {
        setSettings(current => ({ ...current, appName: currentAccount?.name || current.appName }));
        if (canEditWholesale) setWholesale(current => ({ ...current, businessDetails: { ...current.businessDetails, name: currentAccount?.name || current.businessDetails.name, website: current.businessDetails.website || currentAccount?.wooUrl || currentAccount?.domain || '' } }));
        toast.success('Available store details have been applied.');
    };

    const importWebsite = async () => {
        setImporting(true); setImportWarning('');
        try {
            const result = await service.importBranding();
            setCandidates(result.candidates); setSources(result.sourceUrls);
            setSettings(current => ({
                ...current,
                appName: !currentAccount?.appearance?.appName ? result.candidates.businessNames[0] || currentAccount?.name || current.appName : current.appName,
                logoUrl: current.logoUrl || result.candidates.logoUrls[0] || '',
                primaryColor: !currentAccount?.appearance?.primaryColor ? result.candidates.colors[0] || current.primaryColor : current.primaryColor,
            }));
            setWholesale(current => applyBrandingCandidates({ ...current, businessDetails: { ...current.businessDetails, website: current.businessDetails.website || currentAccount?.wooUrl || '' } }, result.candidates));
            if (!Object.values(result.candidates).some(items => items.length)) setImportWarning('No public branding details were found. You can enter everything manually below.');
            else toast.success('Store branding found. Blank fields were filled automatically.');
        } catch (reason) {
            setImportWarning(`${reason instanceof Error ? reason.message : 'Website import failed.'} You can continue with manual entry.`);
        } finally { setImporting(false); }
    };

    const applyCandidate = (kind: BrandingCandidateKind, candidate: string) => {
        if (kind === 'logoUrls') return setSettings(current => ({ ...current, logoUrl: candidate }));
        if (kind === 'businessNames') return setSettings(current => ({ ...current, appName: candidate }));
        if (kind === 'colors' && settings.primaryColor === DEFAULT_COLOR) return setSettings(current => ({ ...current, primaryColor: candidate }));
        setWholesale(current => applyBrandingCandidate(current, kind, candidate));
    };

    const save = async () => {
        if (!currentAccount || !token) return;
        if (!/^#[0-9a-f]{6}$/i.test(settings.primaryColor)) return toast.error('Primary colour must be a six-digit hex value, such as #2563EB.');
        if (settings.logoUrl) {
            try { new URL(settings.logoUrl); } catch { return toast.error('Logo URL must be a complete http or https URL.'); }
            if (!/^https?:\/\//i.test(settings.logoUrl)) return toast.error('Logo URL must start with http:// or https://.');
        }
        setIsSaving(true);
        try {
            if (canEditWholesale) await service.saveBranding({ ...wholesale, logoUrl: settings.logoUrl || null, primaryColor: settings.primaryColor || null, accentColor: wholesale.accentColor || null, headingFont: wholesale.headingFont || null, bodyFont: wholesale.bodyFont || null, businessDetails: { ...wholesale.businessDetails, name: settings.appName } });
            if (canEditAppearance) {
                const response = await fetch(`/api/accounts/${currentAccount.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ appearance: { ...(currentAccount.appearance || {}), ...settings } }) });
                if (!response.ok) throw new Error('Failed to update branding');
                await refreshAccounts();
            }
            toast.success(canEditAppearance && canEditWholesale ? 'Branding saved everywhere.' : canEditWholesale ? 'Catalog branding saved.' : 'Branding and appearance saved.');
        } catch (error) {
            Logger.error('Failed to save branding', { error });
            toast.error(error instanceof Error ? error.message : 'Failed to save branding.');
        } finally { setIsSaving(false); }
    };

    const updateSocialLink = (index: number, key: 'label' | 'href', value: string) => setSettings(current => ({ ...current, socialLinks: current.socialLinks.map((link, itemIndex) => itemIndex === index ? { ...link, [key]: value } : link) }));

    return <div className="space-y-6">
        <div className="flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-indigo-900 dark:bg-indigo-950/20">
            <div><div className="font-semibold text-slate-900 dark:text-white">One brand, used everywhere</div><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">These defaults are shared by the dashboard, emails and {wholesaleEnabled ? 'wholesale catalogs' : 'other customer-facing content'}.</p></div>
            <button type="button" onClick={fillFromAccount} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300"><RefreshCw size={16} /> Use store details</button>
        </div>

        <section className="rounded-2xl border border-slate-200 p-5 dark:border-slate-700">
            <div className="mb-5 flex items-center gap-3"><span className="rounded-xl bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950"><Palette size={19} /></span><div><h3 className="font-semibold text-slate-900 dark:text-white">Brand identity</h3><p className="text-sm text-slate-500">Set this once instead of repeating it for each output.</p></div></div>
            <div className="grid gap-5 md:grid-cols-2">
                <Field label="Brand name" hint="Shown in the sidebar, browser title and wholesale catalog." value={settings.appName} onChange={appName => setSettings({ ...settings, appName })} />
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Primary colour<div className="mt-1 flex gap-3"><input aria-label="Primary colour picker" type="color" value={settings.primaryColor} onChange={event => setSettings({ ...settings, primaryColor: event.target.value })} className="h-10 w-16 cursor-pointer rounded-lg border border-slate-300 p-1" /><input aria-label="Primary colour hex value" value={settings.primaryColor} onChange={event => setSettings({ ...settings, primaryColor: event.target.value })} className={`${inputClass} font-mono uppercase`} /></div><span className="mt-1 block text-xs font-normal text-slate-500">Used for buttons, highlights and catalog accents.</span></label>
                <div className="md:col-span-2"><Field label="Logo URL" type="url" hint="A direct PNG, JPEG, WebP or SVG URL. Catalog PDFs work best with PNG or JPEG." value={settings.logoUrl} onChange={logoUrl => { setSettings({ ...settings, logoUrl }); setLogoPreviewFailed(false); }} placeholder="https://example.com/logo.png" />{settings.logoUrl && !logoPreviewFailed && <div className="mt-3 flex h-20 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900"><img src={settings.logoUrl} alt="Brand logo preview" className="max-h-full max-w-full object-contain" onError={() => setLogoPreviewFailed(true)} /></div>}{logoPreviewFailed && <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">We could not load a preview from this URL.</div>}{!settings.logoUrl && <div className="mt-3 flex h-16 items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 text-sm text-slate-400 dark:border-slate-700"><Image size={18} /> Logo preview</div>}</div>
            </div>
        </section>

        <section className="rounded-2xl border border-slate-200 p-5 dark:border-slate-700">
            <div className="mb-4"><h3 className="font-semibold text-slate-900 dark:text-white">Social profiles</h3><p className="mt-1 text-sm text-slate-500">Automatically available to email templates and social blocks.</p></div>
            <div className="space-y-3">{settings.socialLinks.map((link, index) => <div key={index} className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)_auto] gap-2"><input aria-label={`Social platform ${index + 1}`} value={link.label} onChange={event => updateSocialLink(index, 'label', event.target.value)} className={inputClass} placeholder="Platform" /><input aria-label={`${link.label || 'Social'} URL`} type="url" value={link.href} onChange={event => updateSocialLink(index, 'href', event.target.value)} className={inputClass} placeholder="https://..." /><button type="button" aria-label={`Remove ${link.label || 'social profile'}`} onClick={() => setSettings(current => ({ ...current, socialLinks: current.socialLinks.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded-xl p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={17} /></button></div>)}</div>
            <button type="button" onClick={() => setSettings(current => ({ ...current, socialLinks: [...current.socialLinks, { label: '', href: '' }] }))} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-indigo-600"><Plus size={15} /> Add profile</button>
        </section>

        {canViewWholesale && <WholesaleBrandingSettings value={wholesale} onChange={setWholesale} loading={loadingWholesale} canEdit={canEditWholesale} importing={importing} importWarning={importWarning} candidates={candidates} sources={sources} onImport={() => void importWebsite()} onApplyCandidate={applyCandidate} />}

        <div className="sticky bottom-4 z-10 flex items-center justify-between rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <button type="button" onClick={() => { setSettings({ appName: currentAccount?.name || 'OverSeek', primaryColor: DEFAULT_COLOR, logoUrl: '', socialLinks: defaultSocialLinks() }); setWholesale(current => ({ ...current, logoUrl: null, primaryColor: null })); }} className="inline-flex items-center gap-1 px-2 text-sm text-slate-500 hover:text-slate-700"><RefreshCw size={14} /> Reset</button>
            {(canEditAppearance || canEditWholesale) && <button type="button" onClick={() => void save()} disabled={isSaving || loadingWholesale} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 font-semibold text-white disabled:opacity-50" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(settings.primaryColor) ? settings.primaryColor : DEFAULT_COLOR }}>{isSaving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}{isSaving ? 'Saving...' : 'Save branding'}</button>}
        </div>
    </div>;
}

function Field({ label, hint, value, onChange, type = 'text', placeholder }: { label: string; hint?: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
    return <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}<input type={type} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className={`mt-1 ${inputClass}`} />{hint && <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span>}</label>;
}
