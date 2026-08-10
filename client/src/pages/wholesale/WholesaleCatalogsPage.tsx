import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, BookOpen, Check, ChevronDown, Cog, Copy, Loader2, Plus, RefreshCw, RotateCcw, Save, Sparkles, Trash2, X } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../context/ToastContext';
import { createWholesaleCatalogService } from '../../services/wholesaleCatalogService';
import type { WholesaleBranding, WholesaleCatalog, WholesaleCatalogInput, WholesaleDefaults, WholesaleProductSummary, WholesaleRevision, WholesaleTaxImportCandidate, WholesaleTaxImportSource, WholesaleTermsSection, WholesaleTermsSummaryResult } from '../../types/wholesaleCatalog';
import { WholesaleGenerationPanelForCatalog } from '../../components/wholesale/WholesaleGenerationPanel';
import { WholesaleSharingPanel } from '../../components/wholesale/WholesaleSharingPanel';
import { WholesaleCatalogPreview } from '../../components/wholesale/WholesaleCatalogPreview';
import { acceptTermsSuggestion, applyTaxImportCandidate, moveTermsSection, updateTermsSection } from '../../components/wholesale/wholesaleEditorHelpers';

const EMPTY_CATALOG: WholesaleCatalogInput = {
    name: '', publicTitle: '', subtitle: '', coverText: '', pricesIncludeTax: false,
    supplementaryPriceNotice: '', brandingOverrides: {}, paymentCallout: {}, termsSections: [], footerDetails: {}, status: 'DRAFT',
};
const EMPTY_DEFAULTS: WholesaleDefaults = { priceTaxBasis: 'EXCLUSIVE', gstRate: '10', termsDocument: { sections: [] }, confidentialityNotice: '', privacyNotice: '', setupChecklist: [] };
const EMPTY_BRANDING: WholesaleBranding = { logoUrl: null, primaryColor: null, accentColor: null, headingFont: null, bodyFont: null, businessDetails: {} };

type PageTab = 'catalogs' | 'setup';
type WholesaleService = ReturnType<typeof createWholesaleCatalogService>;
type WholesalePreviewData = { catalog: WholesaleCatalog; products: WholesaleProductSummary[]; defaults: WholesaleDefaults; branding: WholesaleBranding };
const GenerationDetailContext = createContext<{ catalogId: string; service: WholesaleService; canEdit: boolean; canGenerate: boolean; canShare: boolean; preview: WholesalePreviewData | null; setPreview: (preview: WholesalePreviewData | null) => void } | null>(null);

export function WholesaleCatalogsPage() {
    const api = useApi();
    const service = useMemo(() => createWholesaleCatalogService(api), [api]);
    const { hasPermission } = usePermissions();
    const toast = useToast();
    const canView = hasPermission('view_wholesale_catalog');
    const canEdit = hasPermission('edit_wholesale_catalog');
    const canGenerate = hasPermission('generate_wholesale_catalog');
    const canShare = hasPermission('share_wholesale_catalog');
    const [tab, setTab] = useState<PageTab>('catalogs');
    const [catalogs, setCatalogs] = useState<WholesaleCatalog[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [catalogForm, setCatalogForm] = useState<WholesaleCatalogInput | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const loadCatalogs = useCallback(async () => {
        if (!api.isReady || !canView) return;
        setLoading(true);
        setError('');
        try {
            const result = await service.listCatalogs();
            setCatalogs(result.catalogs);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to load catalogs.');
        } finally {
            setLoading(false);
        }
    }, [api.isReady, canView, service]);

    useEffect(() => { void loadCatalogs(); }, [loadCatalogs]);

    if (!canView) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><h1 className="text-lg font-semibold">Wholesale Catalog</h1><p className="mt-2 text-sm">You do not have permission to view wholesale catalogs.</p></div>;

    const saveCatalog = async () => {
        if (!catalogForm || !catalogForm.name.trim() || !catalogForm.publicTitle.trim()) {
            toast.error('Catalog name and public title are required.'); return;
        }
        setBusy(true);
        try {
            if (editingId) await service.updateCatalog(editingId, catalogForm);
            else await service.createCatalog(catalogForm);
            toast.success(editingId ? 'Catalog saved.' : 'Catalog created.');
            setCatalogForm(null); setEditingId(null); await loadCatalogs();
        } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Unable to save catalog.'); }
        finally { setBusy(false); }
    };

    const runCatalogAction = async (action: () => Promise<unknown>, success: string) => {
        setBusy(true);
        try { await action(); toast.success(success); await loadCatalogs(); }
        catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Catalog action failed.'); }
        finally { setBusy(false); }
    };

    return (
        <div className="space-y-6">
            <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-slate-700 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Wholesale Catalog</h1>
                    <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">Review automatically included wholesale-priced products, commercial terms, and controlled catalog revisions.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setTab(current => current === 'setup' ? 'catalogs' : 'setup')}
                        title="Defaults & setup"
                        aria-label="Defaults & setup"
                        aria-pressed={tab === 'setup'}
                        className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${tab === 'setup' ? 'border-blue-600 bg-blue-50 text-blue-600 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-400' : 'border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                    >
                        <Cog size={18} />
                    </button>
                    {canEdit && <button onClick={() => { setTab('catalogs'); setEditingId(null); setCatalogForm({ ...EMPTY_CATALOG }); }} className="inline-flex w-fit items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"><Plus size={18} /> New catalog</button>}
                </div>
            </header>

            {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
            {tab === 'catalogs' && (loading ? <Loading label="Loading catalogs..." /> : <CatalogTable catalogs={catalogs} canEdit={canEdit} busy={busy} onOpen={setSelectedId} onEdit={catalog => { setEditingId(catalog.id); setCatalogForm(toCatalogInput(catalog)); }} onDuplicate={catalog => runCatalogAction(() => service.duplicateCatalog(catalog.id), 'Catalog duplicated.')} onArchive={catalog => runCatalogAction(() => service.updateCatalog(catalog.id, { ...toCatalogInput(catalog), status: 'ARCHIVED' }), 'Catalog archived.')} onDelete={catalog => { if (confirm(`Delete ${catalog.name}? This cannot be undone.`)) void runCatalogAction(() => service.deleteCatalog(catalog.id), 'Catalog deleted.'); }} />)}
            {tab === 'setup' && <DefaultsForm service={service} canEdit={canEdit} />}

            {catalogForm && <CatalogEditor value={catalogForm} editing={!!editingId} busy={busy} service={service} onChange={setCatalogForm} onClose={() => { setCatalogForm(null); setEditingId(null); }} onSave={saveCatalog} />}
            {selectedId && <CatalogDetail catalogId={selectedId} service={service} canEdit={canEdit} canGenerate={canGenerate} canShare={canShare} onClose={() => setSelectedId(null)} onChanged={loadCatalogs} />}
        </div>
    );
}

function CatalogTable({ catalogs, canEdit, busy, onOpen, onEdit, onDuplicate, onArchive, onDelete }: { catalogs: WholesaleCatalog[]; canEdit: boolean; busy: boolean; onOpen: (id: string) => void; onEdit: (catalog: WholesaleCatalog) => void; onDuplicate: (catalog: WholesaleCatalog) => void; onArchive: (catalog: WholesaleCatalog) => void; onDelete: (catalog: WholesaleCatalog) => void }) {
    if (!catalogs.length) return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-800"><div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500"><BookOpen size={24} /></div><h2 className="font-semibold text-slate-800 dark:text-slate-200">No wholesale catalogs yet</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create a catalog to start building a shareable wholesale range.</p></div>;
    return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-800"><div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left text-sm"><thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400"><th className="px-6 py-4">Catalog</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Products</th><th className="px-6 py-4">Revisions</th><th className="px-6 py-4">Updated</th><th className="px-6 py-4 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{catalogs.map(catalog => <tr key={catalog.id} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/30"><td className="px-6 py-4"><button onClick={() => onOpen(catalog.id)} className="font-semibold text-blue-600 hover:text-blue-800 hover:underline dark:text-blue-400 dark:hover:text-blue-300">{catalog.name}</button><div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{catalog.publicTitle}</div></td><td className="px-6 py-4"><Status value={catalog.status} /></td><td className="px-6 py-4 text-slate-700 dark:text-slate-200">{catalog._count?.products || 0}</td><td className="px-6 py-4 text-slate-700 dark:text-slate-200">{catalog._count?.revisions || 0}</td><td className="px-6 py-4 text-slate-500 dark:text-slate-400">{new Date(catalog.updatedAt).toLocaleDateString()}</td><td className="px-6 py-4"><div className="flex justify-end gap-1"><button onClick={() => onOpen(catalog.id)} className="rounded-lg px-2 py-1.5 font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40">Manage</button>{canEdit && catalog.status !== 'ARCHIVED' && <button disabled={busy} onClick={() => onEdit(catalog)} title="Edit" className="rounded-lg px-2 py-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700">Edit</button>}{canEdit && <button disabled={busy} onClick={() => onDuplicate(catalog)} title="Duplicate" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-700"><Copy size={16} /></button>}{canEdit && catalog.status !== 'ARCHIVED' && <button disabled={busy} onClick={() => onArchive(catalog)} title="Archive" className="rounded-lg p-2 text-amber-600 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-400 dark:hover:bg-amber-950/40"><Archive size={16} /></button>}{canEdit && <button disabled={busy} onClick={() => onDelete(catalog)} title="Delete" className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"><Trash2 size={16} /></button>}</div></td></tr>)}</tbody></table></div></div>;
}

function CatalogEditor({ value, editing, busy, service, onChange, onClose, onSave }: { value: WholesaleCatalogInput; editing: boolean; busy: boolean; service: WholesaleService; onChange: (value: WholesaleCatalogInput) => void; onClose: () => void; onSave: () => void }) {
    const field = <K extends keyof WholesaleCatalogInput>(key: K, fieldValue: WholesaleCatalogInput[K]) => onChange({ ...value, [key]: fieldValue });
    const recordField = (key: 'paymentCallout' | 'footerDetails' | 'brandingOverrides', name: string, next: string | number) => field(key, { ...value[key], [name]: next });
    const numericRecordField = (name: string, next: string) => recordField('paymentCallout', name, next === '' ? '' : Number(next));
    return <Modal title={editing ? 'Edit catalog' : 'Create catalog'} onClose={onClose} wide><div className="space-y-7">
        <section className="grid gap-4 sm:grid-cols-2"><Field label="Internal name" value={value.name} onChange={next => field('name', next)} required /><Field label="Public title" value={value.publicTitle} onChange={next => field('publicTitle', next)} required /><Field label="Public subtitle" value={value.subtitle || ''} onChange={next => field('subtitle', next || null)} /><label className="text-sm text-slate-600 dark:text-slate-300">Status<select value={value.status} onChange={event => field('status', event.target.value as WholesaleCatalogInput['status'])} className={inputClass}><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option></select></label><label className="sm:col-span-2 text-sm text-slate-600 dark:text-slate-300">Cover text<textarea rows={4} value={value.coverText || ''} onChange={event => field('coverText', event.target.value || null)} className={inputClass} /></label><Field label="Cover logo override URL" value={String(value.brandingOverrides.coverLogoUrl || '')} onChange={next => recordField('brandingOverrides', 'coverLogoUrl', next)} /><Field label="Cover accent color override" type="color" value={String(value.brandingOverrides.coverAccentColor || '#4f46e5')} onChange={next => recordField('brandingOverrides', 'coverAccentColor', next)} /><label className="sm:col-span-2 text-sm text-slate-600 dark:text-slate-300">Supplementary price notice<textarea rows={2} value={value.supplementaryPriceNotice || ''} onChange={event => field('supplementaryPriceNotice', event.target.value || null)} className={inputClass} /></label><label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" checked={value.pricesIncludeTax} onChange={event => field('pricesIncludeTax', event.target.checked)} /> Prices include tax</label></section>
        <EditorSection title="Payment callout" description="Structured payment thresholds shown in the catalog."><div className="grid gap-4 sm:grid-cols-2"><Field label="Heading" value={String(value.paymentCallout.heading || '')} onChange={next => recordField('paymentCallout', 'heading', next)} /><Field label="Deposit percentage" type="number" value={String(value.paymentCallout.depositPercentage ?? '')} onChange={next => numericRecordField('depositPercentage', next)} /><Field label="Minimum deposit" type="number" value={String(value.paymentCallout.minimumDeposit ?? '')} onChange={next => numericRecordField('minimumDeposit', next)} /><Field label="High-value order threshold" type="number" value={String(value.paymentCallout.highValueThreshold ?? '')} onChange={next => numericRecordField('highValueThreshold', next)} /><label className="sm:col-span-2 text-sm text-slate-600 dark:text-slate-300">Support text<textarea rows={3} value={String(value.paymentCallout.supportText || value.paymentCallout.content || '')} onChange={event => recordField('paymentCallout', 'supportText', event.target.value)} className={inputClass} /></label></div></EditorSection>
        <EditorSection title="Catalog terms" description="Keep 1 to 12 ordered sections. New catalogs may already contain copied approved defaults."><TermsEditor sections={value.termsSections} disabled={false} service={service} onChange={sections => field('termsSections', sections)} /></EditorSection>
    </div><div className="mt-6 flex justify-end gap-3"><button onClick={onClose} className="rounded-xl px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300">Cancel</button><button onClick={onSave} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 font-medium text-white disabled:opacity-50">{busy ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} Save catalog</button></div></Modal>;
}

function CatalogDetail(props: { catalogId: string; service: WholesaleService; canEdit: boolean; canGenerate: boolean; canShare: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
    const [preview, setPreview] = useState<WholesalePreviewData | null>(null);
    return <GenerationDetailContext.Provider value={{ catalogId: props.catalogId, service: props.service, canEdit: props.canEdit, canGenerate: props.canGenerate, canShare: props.canShare, preview, setPreview }}><CatalogDetailContent {...props} /></GenerationDetailContext.Provider>;
}

function CatalogDetailContent({ catalogId, service, canEdit, onClose, onChanged }: { catalogId: string; service: WholesaleService; canEdit: boolean; canGenerate: boolean; canShare: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const detailContext = useContext(GenerationDetailContext);
  const [catalog, setCatalog] = useState<WholesaleCatalog | null>(null);
  const [revisions, setRevisions] = useState<WholesaleRevision[]>([]);
  const [defaults, setDefaults] = useState<WholesaleDefaults>(EMPTY_DEFAULTS);
  const [branding, setBranding] = useState<WholesaleBranding>(EMPTY_BRANDING);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, history, defaultResult, brandingResult] = await Promise.all([service.getCatalog(catalogId), service.listRevisions(catalogId), service.getDefaults(), service.getBranding()]);
      setCatalog(detail.catalog);
      setRevisions(history.revisions);
      setDefaults(defaultResult.defaults);
      setBranding(brandingResult.branding);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Unable to load catalog details.');
    } finally {
      setLoading(false);
    }
  }, [catalogId, service, toast]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      void load();
      void onChanged();
    };
    window.addEventListener(`wholesale-catalog-updated:${catalogId}`, refresh);
    return () => window.removeEventListener(`wholesale-catalog-updated:${catalogId}`, refresh);
  }, [catalogId, load, onChanged]);
  const act = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(message);
      await load();
      await onChanged();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };
  const automaticProducts = useMemo(
    () =>
      (catalog?.products || []).filter((item) => !item.isSuspended).map((item) => ({
        ...item.product,
        categoryLabel: item.categoryLabel || item.product.categoryLabel,
      })),
    [catalog],
  );
  useEffect(() => {
    detailContext?.setPreview(catalog ? { catalog, products: automaticProducts, defaults, branding } : null);
  }, [automaticProducts, branding, catalog, defaults, detailContext?.setPreview]);
  return (
    <Modal title={catalog?.name || 'Catalog details'} onClose={onClose} wide>
      {loading ? (
        <Loading label="Loading catalog details..." />
      ) : (
        catalog && (
          <div className="space-y-8">
            <div className="flex flex-wrap items-center gap-3">
              <Status value={catalog.status} />
              <span className="text-sm text-slate-500">{automaticProducts.length} automatically included wholesale-priced {automaticProducts.length === 1 ? 'product' : 'products'}</span>
            </div>
            <section>
              <div className="mb-3">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-white">Automatically included wholesale-priced products</h3>
                  <p className="text-sm text-slate-500">Active products with wholesale pricing are included automatically.</p>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
                {automaticProducts.map((product) => (
                  <div key={product.id} className="flex items-center gap-3 border-b border-slate-100 p-3 last:border-0 dark:border-slate-700">
                    <img src={product.imageUrl || ''} alt="" className="h-10 w-10 rounded-lg bg-slate-100 object-cover" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-800 dark:text-slate-100">{product.name}</span>
                      <span className="text-xs text-slate-500">{product.sku}</span>
                    </span>
                  </div>
                ))}
                {!automaticProducts.length && <div className="p-8 text-center text-sm text-slate-500">No active wholesale-priced products are automatically included.</div>}
              </div>
            </section>
            <section>
              <h3 className="mb-3 font-semibold text-slate-900 dark:text-white">Revision history</h3>
              <div className="space-y-2">
                {revisions.map((revision) => (
                  <div key={revision.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-100">Revision {revision.revisionNumber}</span>
                      <span className="ml-3 text-xs text-slate-500">{new Date(revision.createdAt).toLocaleString()}</span>
                    </div>
                    {canEdit && catalog.status !== 'ARCHIVED' && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`Restore revision ${revision.revisionNumber}?`)) void act(() => service.restoreRevision(catalogId, revision.id), 'Revision restored.');
                        }}
                        className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50"
                      >
                        <RotateCcw size={15} /> Restore
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
            <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">PDF generation and sharing will be available in a later tranche. No generation or sharing action is currently performed.</div>
          </div>
        )
      )}
    </Modal>
  );
}

function DefaultsForm({ service, canEdit }: { service: ReturnType<typeof createWholesaleCatalogService>; canEdit: boolean }) {
    const toast = useToast();
    const [importing, setImporting] = useState(false);
    const [candidate, setCandidate] = useState<WholesaleTaxImportCandidate | null>(null);
    const [appliedCandidate, setAppliedCandidate] = useState<WholesaleTaxImportCandidate | null>(null);
    const importTax = async () => {
        setImporting(true);
        try { setCandidate((await service.importTaxDefaults()).candidate); }
        catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Unable to import WooCommerce tax settings.'); }
        finally { setImporting(false); }
    };
    return <div className="space-y-5">{canEdit && <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5 dark:border-indigo-900 dark:bg-indigo-950/20"><button type="button" disabled={importing} onClick={() => void importTax()} className="inline-flex items-center gap-2 rounded-xl border border-indigo-300 bg-white px-4 py-2 font-semibold text-indigo-700 disabled:opacity-50 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300">{importing ? <Loader2 className="animate-spin" size={17} /> : <RefreshCw size={17} />} Import tax from WooCommerce</button><p className="mt-2 text-xs text-slate-500">Imports a review candidate only. Nothing is applied, saved, or approved automatically.</p></div>}{candidate && <TaxCandidateReview candidate={candidate} onApply={() => setAppliedCandidate({ ...candidate })} />}<DefaultsFormFields service={service} canEdit={canEdit} appliedCandidate={appliedCandidate} /></div>;
}

function DefaultsFormFields({ service, canEdit, appliedCandidate }: { service: ReturnType<typeof createWholesaleCatalogService>; canEdit: boolean; appliedCandidate: WholesaleTaxImportCandidate | null }) {
    const toast = useToast(); const [value, setValue] = useState(EMPTY_DEFAULTS); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [approving, setApproving] = useState(false); const [approvalError, setApprovalError] = useState(''); const [approvalWillClear, setApprovalWillClear] = useState(false);
    useEffect(() => { service.getDefaults().then(result => setValue(result.defaults)).catch((reason: Error) => toast.error(reason.message)).finally(() => setLoading(false)); }, [service, toast]);
    useEffect(() => { if (appliedCandidate && !loading) setValue(current => applyTaxImportCandidate(current, appliedCandidate)); }, [appliedCandidate, loading]);
    const legalChange = (next: Partial<Pick<WholesaleDefaults, 'termsDocument' | 'confidentialityNotice' | 'privacyNotice'>>) => { if (value.approvedAt) setApprovalWillClear(true); setValue({ ...value, ...next }); };
    const save = async () => { setSaving(true); try { const result = await service.saveDefaults(value); setValue(result.defaults); setApprovalWillClear(false); toast.success('Wholesale defaults saved.'); } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Unable to save defaults.'); } finally { setSaving(false); } };
    const approve = async () => { setApproving(true); setApprovalError(''); try { const result = await service.approveDefaults(); setValue(result.defaults); setApprovalWillClear(false); toast.success('Wholesale defaults approved.'); } catch (reason) { const message = reason instanceof Error ? reason.message : 'Unable to approve defaults.'; const explanation = /403|owner|admin|permission|insufficient/i.test(message) ? 'Only an account owner or admin can approve defaults.' : message; setApprovalError(explanation); toast.error(explanation); } finally { setApproving(false); } };
    if (loading) return <Loading label="Loading defaults..." />;
    return <FormCard title="Commercial defaults" description="PUT edits remain drafts until separately approved. Catalog creation copies legal defaults only after approval."><div className="mb-5 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700"><div className="font-semibold text-slate-800 dark:text-slate-100">Approval: {value.approvedAt ? `Approved ${new Date(value.approvedAt).toLocaleString()}` : 'Not approved'}</div><p className="mt-1 text-slate-500">Approval is restricted by the server to account owners and admins. Saving changes to terms, confidentiality, or privacy clears the current approval.</p>{approvalWillClear && <p className="mt-2 font-medium text-amber-700 dark:text-amber-300">These unsaved legal edits will clear the current approval when saved.</p>}{approvalError && <p role="alert" className="mt-2 text-red-600 dark:text-red-300">{approvalError}</p>}</div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-slate-600 dark:text-slate-300">Default tax basis<select disabled={!canEdit} value={value.priceTaxBasis} onChange={event => setValue({ ...value, priceTaxBasis: event.target.value as WholesaleDefaults['priceTaxBasis'] })} className={inputClass}><option value="EXCLUSIVE">Tax exclusive</option><option value="INCLUSIVE">Tax inclusive</option></select></label><Field label="GST rate (%)" type="number" disabled={!canEdit} value={value.gstRate} onChange={gstRate => setValue({ ...value, gstRate })} /><div className="sm:col-span-2"><TermsEditor sections={value.termsDocument.sections} disabled={!canEdit} service={service} onChange={sections => legalChange({ termsDocument: { sections } })} /></div><label className="sm:col-span-2 text-sm text-slate-600 dark:text-slate-300">Confidentiality notice<textarea disabled={!canEdit} rows={4} value={value.confidentialityNotice} onChange={event => legalChange({ confidentialityNotice: event.target.value })} className={inputClass} /></label><label className="sm:col-span-2 text-sm text-slate-600 dark:text-slate-300">Privacy notice<textarea disabled={!canEdit} rows={4} value={value.privacyNotice} onChange={event => legalChange({ privacyNotice: event.target.value })} className={inputClass} /></label></div><SetupChecklistEditor value={value.setupChecklist} disabled={!canEdit} onChange={setupChecklist => setValue({ ...value, setupChecklist })} />{canEdit && <div className="mt-6 flex flex-wrap justify-end gap-3"><button onClick={() => void approve()} disabled={saving || approving || approvalWillClear} className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 px-5 py-2.5 font-medium text-emerald-700 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300">{approving ? <Loader2 className="animate-spin" size={17} /> : <Check size={17} />} Approve defaults</button><button onClick={() => void save()} disabled={saving || approving} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />} Save defaults</button></div>}</FormCard>;
}

function TaxCandidateReview({ candidate, onApply }: { candidate: WholesaleTaxImportCandidate; onApply: () => void }) {
    const sourceLabel = (source: WholesaleTaxImportSource) => ({ WOOCOMMERCE_SETTINGS: 'WooCommerce tax settings', WOOCOMMERCE_TAX_RATES: 'WooCommerce tax rates', ACCOUNT_REVENUE_TAX_SETTING: 'account revenue tax fallback', DEFAULT_GST_RATE: '10% GST fallback' })[source];
    return <div className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm dark:border-indigo-900 dark:bg-slate-800"><h3 className="font-semibold text-slate-900 dark:text-white">Review imported tax candidate</h3><p className="mt-1 text-xs text-slate-500">Apply this candidate to the unsaved form, then Save defaults. Owner/admin approval remains a separate action.</p><dl className="mt-4 grid gap-3 sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Tax basis</dt><dd className="font-semibold text-slate-800 dark:text-slate-100">{candidate.priceTaxBasis} <span className="font-normal text-slate-500">from {sourceLabel(candidate.source.priceTaxBasis)}</span></dd></div><div><dt className="text-xs text-slate-500">GST rate</dt><dd className="font-semibold text-slate-800 dark:text-slate-100">{candidate.gstRate}% <span className="font-normal text-slate-500">from {sourceLabel(candidate.source.gstRate)}</span></dd></div></dl>{candidate.warnings.length > 0 && <ul role="alert" className="mt-4 list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-300">{candidate.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}<button type="button" onClick={onApply} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Apply to unsaved form</button></div>;
}

function TermsEditor({ sections, disabled, service, onChange }: { sections: WholesaleTermsSection[]; disabled: boolean; service: WholesaleService; onChange: (sections: WholesaleTermsSection[]) => void }) {
    const toast = useToast();
    const [expandedIndex, setExpandedIndex] = useState<number | null>(sections.length ? 0 : null);
    const [busyIndex, setBusyIndex] = useState<number | null>(null);
    const [results, setResults] = useState<Record<number, WholesaleTermsSummaryResult>>({});

    const summarize = async (index: number) => {
        setBusyIndex(index);
        try {
            const result = await service.summarizeTerms(sections[index]);
            setResults(current => ({ ...current, [index]: result }));
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Unable to request a shorter terms suggestion.');
        } finally {
            setBusyIndex(null);
        }
    };
    const clearResult = (index: number) => setResults(current => { const next = { ...current }; delete next[index]; return next; });
    const addSection = () => {
        onChange([...sections, { heading: 'New section', content: '' }]);
        setExpandedIndex(sections.length);
    };
    const moveSection = (index: number, direction: -1 | 1) => {
        const destination = index + direction;
        onChange(moveTermsSection(sections, index, direction));
        setExpandedIndex(current => current === index ? destination : current === destination ? index : current);
        setResults(current => {
            const next = { ...current };
            const sourceResult = next[index];
            const destinationResult = next[destination];
            delete next[index];
            delete next[destination];
            if (sourceResult) next[destination] = sourceResult;
            if (destinationResult) next[index] = destinationResult;
            return next;
        });
    };
    const removeSection = (index: number) => {
        onChange(sections.filter((_, sectionIndex) => sectionIndex !== index));
        setExpandedIndex(current => {
            if (current === null) return null;
            if (sections.length === 1) return null;
            if (current === index) return Math.min(index, sections.length - 2);
            return current > index ? current - 1 : current;
        });
        setResults(current => Object.fromEntries(Object.entries(current).flatMap(([key, result]) => {
            const resultIndex = Number(key);
            if (resultIndex === index) return [];
            return [[resultIndex > index ? resultIndex - 1 : resultIndex, result]];
        })));
    };

    return <div className="space-y-3">
        <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold text-slate-900 dark:text-white">Structured terms</h3><p className="text-xs text-slate-500">Catalog terms render at approximately 8pt. Expand a section to review or edit it.</p></div>{!disabled && sections.length < 12 && <button type="button" onClick={addSection} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"><Plus size={15} /> Add section</button>}</div>
        <div className="space-y-2">{sections.map((section, index) => { const expanded = expandedIndex === index; const result = results[index]; return <section key={index} className={`overflow-hidden rounded-xl border transition-colors ${expanded ? 'border-blue-200 bg-white shadow-sm dark:border-blue-800 dark:bg-slate-900/30' : 'border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/20'}`}>
            <button type="button" onClick={() => setExpandedIndex(current => current === index ? null : index)} aria-expanded={expanded} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{section.heading.trim() || `Section ${index + 1}`}</span>{!expanded && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{section.content.trim() || 'No content added'}</span>}</span><span className="text-xs text-slate-400">{section.content.length} chars</span><ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} /></button>
            {expanded && <div className="border-t border-slate-200 p-4 dark:border-slate-700"><div className="grid gap-3 sm:grid-cols-[1fr_auto]"><div className="space-y-3"><Field label={`Section ${index + 1} heading`} disabled={disabled} value={section.heading} onChange={heading => onChange(updateTermsSection(sections, index, { heading }))} /><label className="block text-sm text-slate-600 dark:text-slate-300">Content<textarea disabled={disabled} rows={5} maxLength={5000} value={section.content} onChange={event => onChange(updateTermsSection(sections, index, { content: event.target.value }))} className={inputClass} /><span className="mt-1 block text-xs text-slate-500">{section.content.length}/5000 characters. Preserve numbers, dates, thresholds, exceptions, rights, and obligations when shortening.</span></label></div>{!disabled && <div className="flex gap-1 sm:flex-col"><button type="button" aria-label={`Move section ${index + 1} up`} disabled={index === 0} onClick={() => moveSection(index, -1)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-700"><ArrowUp size={16} /></button><button type="button" aria-label={`Move section ${index + 1} down`} disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-700"><ArrowDown size={16} /></button><button type="button" aria-label={`Remove terms section ${index + 1}`} onClick={() => removeSection(index)} className="rounded-lg p-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"><Trash2 size={16} /></button></div>}</div>
                {!disabled && <button type="button" disabled={busyIndex !== null || !section.heading.trim() || section.content.trim().length < 20} onClick={() => void summarize(index)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 disabled:opacity-40 dark:border-violet-800 dark:text-violet-300">{busyIndex === index ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />} Request shorter suggestion</button>}
                {result?.manualGuidance && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{result.manualGuidance}</div>}
                {result?.suggestion && <div className="mt-3 grid gap-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3 text-sm dark:border-violet-800 dark:bg-violet-950/20 sm:grid-cols-2"><div><div className="mb-1 font-semibold text-red-700 dark:text-red-300">Before</div><div className="font-medium">{section.heading}</div><p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{section.content}</p></div><div><div className="mb-1 font-semibold text-emerald-700 dark:text-emerald-300">Suggested after</div><div className="font-medium">{result.suggestion.heading}</div><p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{result.suggestion.content}</p></div><div className="flex gap-2 sm:col-span-2"><button type="button" onClick={() => { onChange(acceptTermsSuggestion(sections, index, result.suggestion!)); clearResult(index); }} className="rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white">Accept as unsaved edit</button><button type="button" onClick={() => clearResult(index)} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-300">Reject</button></div></div>}
            </div>}
        </section>; })}</div>
        {!sections.length && <div className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500 dark:border-slate-700">No terms sections. Add at least one before approval or generation.</div>}
    </div>;
}

function EditorSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
    return <section className="border-t border-slate-200 pt-6 dark:border-slate-700"><h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3><p className="mb-4 mt-1 text-xs text-slate-500">{description}</p>{children}</section>;
}

function SetupChecklistEditor({ value, disabled, onChange }: { value: WholesaleDefaults['setupChecklist']; disabled: boolean; onChange: (value: WholesaleDefaults['setupChecklist']) => void }) {
    return <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-700"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold text-slate-900 dark:text-white">Setup checklist</h3><p className="text-xs text-slate-500">Track the account preparation needed before publishing catalogs.</p></div>{!disabled && value.length < 30 && <button type="button" onClick={() => onChange([...value, { key: `setup-${Date.now()}`, label: 'New setup item', completed: false }])} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50"><Plus size={15} /> Add item</button>}</div><div className="space-y-2">{value.map((item, index) => <div key={item.key} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"><input type="checkbox" disabled={disabled} checked={item.completed} onChange={event => onChange(value.map((entry, entryIndex) => entryIndex === index ? { ...entry, completed: event.target.checked } : entry))} /><input aria-label={`Setup item ${index + 1}`} disabled={disabled} value={item.label} onChange={event => onChange(value.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry))} className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none disabled:opacity-60 dark:text-slate-100" />{!disabled && <button type="button" aria-label={`Remove setup item ${index + 1}`} onClick={() => onChange(value.filter((_, entryIndex) => entryIndex !== index))} className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>}</div>)}{!value.length && <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700">No setup items configured.</div>}</div></div>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) { const generationDetail = useContext(GenerationDetailContext); return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"><div role="dialog" aria-modal="true" className={`max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900 ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}><div className="mb-6 flex items-center justify-between"><h2 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h2><button onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20} /></button></div>{children}{generationDetail?.preview && <div className="mt-8 border-t border-slate-200 pt-7 dark:border-slate-700"><WholesaleCatalogPreview {...generationDetail.preview} /></div>}{generationDetail && <WholesaleGenerationPanelForCatalog {...generationDetail} />}{generationDetail?.canShare && <WholesaleSharingPanel catalogId={generationDetail.catalogId} service={generationDetail.service} canGenerate={generationDetail.canGenerate} />}</div></div>; }
function FormCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800/80"><h2 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h2><p className="mb-6 mt-1 text-sm text-slate-500">{description}</p>{children}</section>; }
function Field({ label, value, onChange, required, disabled, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean; type?: string }) { return <label className="text-sm text-slate-600 dark:text-slate-300">{label}{required && ' *'}<input type={type} required={required} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} className={inputClass} /></label>; }
function Loading({ label }: { label: string }) { return <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-12 text-slate-500 dark:border-slate-700 dark:bg-slate-800"><Loader2 className="animate-spin" size={20} />{label}</div>; }
function Status({ value }: { value: WholesaleCatalog['status'] }) { const tone = value === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : value === 'ARCHIVED' ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'; return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{value}</span>; }
function toCatalogInput(catalog: WholesaleCatalog): WholesaleCatalogInput { return { name: catalog.name, publicTitle: catalog.publicTitle, subtitle: catalog.subtitle, coverText: catalog.coverText, pricesIncludeTax: catalog.pricesIncludeTax, supplementaryPriceNotice: catalog.supplementaryPriceNotice, brandingOverrides: catalog.brandingOverrides || {}, paymentCallout: catalog.paymentCallout || {}, termsSections: catalog.termsSections || [], footerDetails: catalog.footerDetails || {}, status: catalog.status }; }
const inputClass = 'mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
