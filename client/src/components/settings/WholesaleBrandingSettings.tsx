import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useAccount } from '../../context/AccountContext';
import { useApi } from '../../hooks/useApi';
import { usePermissions } from '../../hooks/usePermissions';
import { createWholesaleCatalogService } from '../../services/wholesaleCatalogService';
import type { WholesaleBranding, WholesaleBrandingImportCandidates } from '../../types/wholesaleCatalog';
import { applyBrandingCandidate, type BrandingCandidateKind } from '../wholesale/wholesaleEditorHelpers';

const EMPTY_BRANDING: WholesaleBranding = { logoUrl: null, primaryColor: null, accentColor: null, headingFont: null, bodyFont: null, businessDetails: {} };
const inputClass = 'mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

export function WholesaleBrandingSettings() {
    const api = useApi();
    const { currentAccount } = useAccount();
    const service = useMemo(() => createWholesaleCatalogService(api), [api]);
    const { hasPermission } = usePermissions();
    const toast = useToast();
    const canView = hasPermission('view_wholesale_catalog');
    const canEdit = hasPermission('edit_wholesale_catalog');
    const [value, setValue] = useState(EMPTY_BRANDING);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [importing, setImporting] = useState(false);
    const [candidates, setCandidates] = useState<WholesaleBrandingImportCandidates | null>(null);
    const [sources, setSources] = useState<string[]>([]);
    const [importWarning, setImportWarning] = useState('');

    useEffect(() => {
        if (!api.isReady || !canView) { setLoading(false); return; }
        setLoading(true);
        service.getBranding().then(result => setValue(result.branding)).catch((reason: Error) => toast.error(reason.message)).finally(() => setLoading(false));
    }, [api.isReady, canView, service, toast]);

    if (!canView) return null;

    const save = async () => {
        setSaving(true);
        try {
            const result = await service.saveBranding({ ...value, logoUrl: value.logoUrl || null, primaryColor: value.primaryColor || null, accentColor: value.accentColor || null, headingFont: value.headingFont || null, bodyFont: value.bodyFont || null });
            setValue(result.branding);
            toast.success('Wholesale catalog branding saved.');
        } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Unable to save catalog branding.'); }
        finally { setSaving(false); }
    };

    const importWebsite = async () => {
        setImporting(true); setImportWarning('');
        try {
            const result = await service.importBranding();
            setCandidates(result.candidates); setSources(result.sourceUrls);
            if (!Object.values(result.candidates).some(items => items.length)) setImportWarning('No branding candidates were found. Continue with the manual fields below.');
        } catch (reason) {
            const message = reason instanceof Error ? reason.message : 'Website import failed.';
            setImportWarning(`${message} Continue with manual branding entry.`);
        } finally { setImporting(false); }
    };

    return <section className="border-t border-gray-100 pt-6 dark:border-slate-700">
        <div className="mb-5"><h3 className="text-lg font-semibold text-gray-900 dark:text-white">Wholesale catalog branding</h3><p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Saved once for all wholesale catalogs. Individual catalogs can still use an intentional cover override.</p></div>
        {loading ? <div className="flex items-center gap-2 py-6 text-sm text-gray-500"><Loader2 className="animate-spin" size={18} /> Loading catalog branding...</div> : <>
            {canEdit && <div className="mb-5 flex flex-wrap gap-2"><button type="button" onClick={() => setValue(current => ({ ...current, logoUrl: currentAccount?.appearance?.logoUrl || current.logoUrl, primaryColor: currentAccount?.appearance?.primaryColor || current.primaryColor, businessDetails: { ...current.businessDetails, name: currentAccount?.appearance?.appName || currentAccount?.name || current.businessDetails.name } }))} className="inline-flex items-center gap-2 rounded-xl border border-indigo-300 px-4 py-2 font-semibold text-indigo-700 dark:border-indigo-800 dark:text-indigo-300"><RefreshCw size={17} /> Use dashboard branding</button><button type="button" disabled={importing} onClick={() => void importWebsite()} className="inline-flex items-center gap-2 rounded-xl border border-indigo-300 px-4 py-2 font-semibold text-indigo-700 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300">{importing ? <Loader2 className="animate-spin" size={17} /> : <RefreshCw size={17} />} Import from Woo website</button></div>}
            {importWarning && <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{importWarning}</div>}
            {candidates && <CandidateReview candidates={candidates} sources={sources} onApply={(kind, candidate) => setValue(current => applyBrandingCandidate(current, kind, candidate))} />}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Logo URL" disabled={!canEdit} value={value.logoUrl || ''} onChange={logoUrl => setValue({ ...value, logoUrl })} />
                <Field label="Business name" disabled={!canEdit} value={String(value.businessDetails.name || '')} onChange={name => setValue({ ...value, businessDetails: { ...value.businessDetails, name } })} />
                <Field label="Primary color" type="color" disabled={!canEdit} value={value.primaryColor || '#4f46e5'} onChange={primaryColor => setValue({ ...value, primaryColor })} />
                <Field label="Accent color" type="color" disabled={!canEdit} value={value.accentColor || '#7c3aed'} onChange={accentColor => setValue({ ...value, accentColor })} />
                <Field label="Heading font" disabled={!canEdit} value={value.headingFont || ''} onChange={headingFont => setValue({ ...value, headingFont })} />
                <Field label="Body font" disabled={!canEdit} value={value.bodyFont || ''} onChange={bodyFont => setValue({ ...value, bodyFont })} />
                <Field label="Contact details" disabled={!canEdit} value={String(value.businessDetails.contact || '')} onChange={contact => setValue({ ...value, businessDetails: { ...value.businessDetails, contact } })} />
                <Field label="Website" disabled={!canEdit} value={String(value.businessDetails.website || '')} onChange={website => setValue({ ...value, businessDetails: { ...value.businessDetails, website } })} />
                <label className="text-sm text-slate-600 dark:text-slate-300 sm:col-span-2">Address<textarea disabled={!canEdit} rows={3} value={String(value.businessDetails.address || '')} onChange={event => setValue({ ...value, businessDetails: { ...value.businessDetails, address: event.target.value } })} className={inputClass} /></label>
            </div>
            {canEdit && <div className="mt-6 flex justify-end"><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />}Save catalog branding</button></div>}
        </>}
    </section>;
}

function CandidateReview({ candidates, sources, onApply }: { candidates: WholesaleBrandingImportCandidates; sources: string[]; onApply: (kind: BrandingCandidateKind, value: string) => void }) {
    const groups: Array<{ kind: BrandingCandidateKind; label: string }> = [{ kind: 'logoUrls', label: 'Logo candidates' }, { kind: 'colors', label: 'Color candidates' }, { kind: 'businessNames', label: 'Business name candidates' }, { kind: 'contactHints', label: 'Contact candidates' }];
    return <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900 dark:bg-indigo-950/20"><h4 className="font-semibold text-slate-900 dark:text-white">Review imported candidates</h4><p className="mt-1 text-xs text-slate-500">Nothing is applied or saved automatically. Color candidates fill primary first, then accent.</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{groups.map(group => <div key={group.kind}><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</div><div className="flex flex-wrap gap-2">{candidates[group.kind].map(candidate => <button type="button" key={candidate} title={candidate} onClick={() => onApply(group.kind, candidate)} className="max-w-full truncate rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">{group.kind === 'colors' && <span className="mr-2 inline-block h-3 w-3 rounded-full border align-middle" style={{ backgroundColor: candidate }} />}{candidate}</button>)}{!candidates[group.kind].length && <span className="text-xs text-slate-400">None found</span>}</div></div>)}</div><div className="mt-4 text-xs text-slate-500">Sources: {sources.length ? sources.join(', ') : 'No source URLs returned'}</div></div>;
}

function Field({ label, value, onChange, disabled, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; type?: string }) {
    return <label className="text-sm text-slate-600 dark:text-slate-300">{label}<input type={type} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} className={inputClass} /></label>;
}
