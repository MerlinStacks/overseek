import { Loader2, RefreshCw } from 'lucide-react';
import type { WholesaleBranding, WholesaleBrandingImportCandidates } from '../../types/wholesaleCatalog';
import type { BrandingCandidateKind } from '../wholesale/wholesaleEditorHelpers';

const inputClass = 'mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

interface WholesaleBrandingSettingsProps {
    value: WholesaleBranding;
    onChange: (value: WholesaleBranding) => void;
    loading: boolean;
    canEdit: boolean;
    importing: boolean;
    importWarning: string;
    candidates: WholesaleBrandingImportCandidates | null;
    sources: string[];
    onImport: () => void;
    onApplyCandidate: (kind: BrandingCandidateKind, candidate: string) => void;
}

/** Catalog-only fields. Shared name, logo and primary colour are edited once above. */
export function WholesaleBrandingSettings({ value, onChange, loading, canEdit, importing, importWarning, candidates, sources, onImport, onApplyCandidate }: WholesaleBrandingSettingsProps) {
    if (loading) return <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="animate-spin" size={18} /> Loading catalog details...</div>;

    const detail = (key: string) => String(value.businessDetails[key] || '');
    const setDetail = (key: string, fieldValue: string) => onChange({ ...value, businessDetails: { ...value.businessDetails, [key]: fieldValue } });

    return <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 dark:border-slate-700 dark:bg-slate-900/30">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div><h3 className="font-semibold text-slate-900 dark:text-white">Catalog details</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Extra business and typography details used in wholesale catalogs. Your name, logo and primary colour are inherited automatically.</p></div>
            {canEdit && <button type="button" disabled={importing} onClick={onImport} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300">{importing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Pull from store website</button>}
        </div>
        {importWarning && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{importWarning}</div>}
        {candidates && <CandidateReview candidates={candidates} sources={sources} onApply={onApplyCandidate} />}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Accent colour" type="color" disabled={!canEdit} value={value.accentColor || '#7c3aed'} onChange={accentColor => onChange({ ...value, accentColor })} />
            <div className="hidden sm:block" />
            <Field label="Heading font" hint="PDF-safe fonts such as Helvetica, Times or Courier." disabled={!canEdit} value={value.headingFont || ''} onChange={headingFont => onChange({ ...value, headingFont })} />
            <Field label="Body font" hint="Unsupported fonts fall back to Helvetica." disabled={!canEdit} value={value.bodyFont || ''} onChange={bodyFont => onChange({ ...value, bodyFont })} />
            <Field label="Legal name" disabled={!canEdit} value={detail('legalName')} onChange={value => setDetail('legalName', value)} />
            <Field label="Business number" disabled={!canEdit} value={detail('businessNumber') || detail('abn')} onChange={value => setDetail('businessNumber', value)} />
            <Field label="Contact email" type="email" disabled={!canEdit} value={detail('contactEmail') || detail('email')} onChange={value => setDetail('contactEmail', value)} />
            <Field label="Contact phone" disabled={!canEdit} value={detail('contactPhone') || detail('phone')} onChange={value => setDetail('contactPhone', value)} />
            <Field label="Website" disabled={!canEdit} value={detail('website')} onChange={value => setDetail('website', value)} />
            <label className="text-sm text-slate-600 dark:text-slate-300 sm:col-span-2">Address<textarea disabled={!canEdit} rows={3} value={detail('address')} onChange={event => setDetail('address', event.target.value)} className={inputClass} /></label>
            <label className="text-sm text-slate-600 dark:text-slate-300 sm:col-span-2">Legal notice<textarea disabled={!canEdit} rows={3} value={detail('legalNotice')} onChange={event => setDetail('legalNotice', event.target.value)} className={inputClass} /></label>
        </div>
    </section>;
}

function CandidateReview({ candidates, sources, onApply }: { candidates: WholesaleBrandingImportCandidates; sources: string[]; onApply: (kind: BrandingCandidateKind, value: string) => void }) {
    const groups: Array<{ kind: BrandingCandidateKind; label: string }> = [{ kind: 'logoUrls', label: 'Logos' }, { kind: 'colors', label: 'Colours' }, { kind: 'businessNames', label: 'Names' }, { kind: 'contactHints', label: 'Contact details' }];
    return <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900 dark:bg-indigo-950/20"><h4 className="font-semibold text-slate-900 dark:text-white">Other details found</h4><p className="mt-1 text-xs text-slate-500">Blank fields were filled automatically. Select any alternative below to use it instead.</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{groups.map(group => <div key={group.kind}><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</div><div className="flex flex-wrap gap-2">{candidates[group.kind].map(candidate => <button type="button" key={candidate} title={candidate} onClick={() => onApply(group.kind, candidate)} className="max-w-full truncate rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">{group.kind === 'colors' && <span className="mr-2 inline-block h-3 w-3 rounded-full border align-middle" style={{ backgroundColor: candidate }} />}{candidate}</button>)}{!candidates[group.kind].length && <span className="text-xs text-slate-400">None found</span>}</div></div>)}</div><div className="mt-4 truncate text-xs text-slate-500" title={sources.join(', ')}>Source: {sources.length ? sources.join(', ') : 'store account data'}</div></div>;
}

function Field({ label, hint, value, onChange, disabled, type = 'text' }: { label: string; hint?: string; value: string; onChange: (value: string) => void; disabled?: boolean; type?: string }) {
    return <label className="text-sm text-slate-600 dark:text-slate-300">{label}<input type={type} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} className={inputClass} />{hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}</label>;
}
