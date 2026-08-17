import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { CheckCircle2, Download, Eye, FileClock, Loader2, RefreshCw, StopCircle, TriangleAlert } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import type { createWholesaleCatalogService } from '../../services/wholesaleCatalogService';
import type { WholesaleBranding, WholesaleCatalog, WholesaleCatalogGeneration, WholesaleDefaults } from '../../types/wholesaleCatalog';
import { canRetryGeneration, defaultValidUntil, generationStatusLabel, isActiveGeneration, productReadinessIssues, staleReasonLabel, toLocalIsoDate } from './generationHelpers';
import { canExtendGenerationValidity, generationValidityMaximum, isValidValidityExtension, needsDownloadedArtifactWarning, recordDownloadedArtifactWarning } from './wholesaleEditorHelpers';

type Service = ReturnType<typeof createWholesaleCatalogService>;

interface Props {
    catalog: WholesaleCatalog;
    service: Service;
    canGenerate: boolean;
}

export function WholesaleGenerationPanelForCatalog({ catalogId, service, canEdit, canGenerate }: { catalogId: string; service: Service; canEdit: boolean; canGenerate: boolean }) {
    const [catalog, setCatalog] = useState<WholesaleCatalog | null>(null);
    const [error, setError] = useState('');
    const [applyingDefaults, setApplyingDefaults] = useState(false);
    const toast = useToast();

    useEffect(() => {
        let active = true;
        service.getCatalog(catalogId)
            .then(result => { if (active) setCatalog(result.catalog); })
            .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load generation details.'); });
        return () => { active = false; };
    }, [catalogId, service]);

    if (error) return <section className="border-t border-slate-200 pt-7 text-sm text-red-600 dark:border-slate-700 dark:text-red-300" role="alert">{error}</section>;
    if (!catalog) return <section className="flex items-center gap-2 border-t border-slate-200 pt-7 text-sm text-slate-500 dark:border-slate-700"><Loader2 className="animate-spin" size={18} /> Loading generation controls...</section>;
    const applyDefaults = async () => {
        if (!window.confirm('Replace this catalog\'s terms with the currently approved defaults? This creates a new revision.')) return;
        setApplyingDefaults(true);
        try {
            const result = await service.applyDefaultTerms(catalogId);
            setCatalog(result.catalog);
            window.dispatchEvent(new Event(`wholesale-catalog-updated:${catalogId}`));
            toast.success('Current approved default terms applied.');
        } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Unable to apply default terms.'); }
        finally { setApplyingDefaults(false); }
    };
    return <>{canEdit && <div className="flex justify-end border-t border-slate-200 pt-6 dark:border-slate-700"><button type="button" disabled={applyingDefaults || catalog.status === 'ARCHIVED'} onClick={() => void applyDefaults()} className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300">{applyingDefaults ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} Apply current default terms</button></div>}<WholesaleGenerationPanel catalog={catalog} service={service} canGenerate={canGenerate} /></>;
}

export function WholesaleGenerationPanel({ catalog, service, canGenerate }: Props) {
    const toast = useToast();
    const [generations, setGenerations] = useState<WholesaleCatalogGeneration[]>([]);
    const [defaults, setDefaults] = useState<WholesaleDefaults | null>(null);
    const [branding, setBranding] = useState<WholesaleBranding | null>(null);
    const [validUntil, setValidUntil] = useState(() => defaultValidUntil());
    const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [extensionValues, setExtensionValues] = useState<Record<string, string>>({});

    const loadGenerations = useCallback(async (showLoading = false) => {
        if (showLoading) setLoading(true);
        try {
            const result = await service.listGenerations();
            setGenerations(result.generations);
            setError('');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to load generation history.');
        } finally {
            if (showLoading) setLoading(false);
        }
    }, [service]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        Promise.all([service.listGenerations(), service.getDefaults(), service.getBranding()])
            .then(([history, defaultResult, brandingResult]) => {
                if (!active) return;
                setGenerations(history.generations);
                setDefaults(defaultResult.defaults);
                setBranding(brandingResult.branding);
                setError('');
            })
            .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load generation readiness.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [service]);

    const hasActiveJob = generations.some(generation => isActiveGeneration(generation) || generation.validityArtifactStatus === 'UPDATING');
    useEffect(() => {
        if (!hasActiveJob) return;
        const poll = () => { if (document.visibilityState === 'visible') void loadGenerations(); };
        const interval = window.setInterval(poll, 4000);
        document.addEventListener('visibilitychange', poll);
        return () => {
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', poll);
        };
    }, [hasActiveJob, loadGenerations]);

    const catalogGenerations = generations.filter(generation => generation.catalogId === catalog.id);
    const staleApproved = catalogGenerations.filter(generation => generation.status === 'APPROVED' && generation.staleAt);
    const currentHistory = catalogGenerations.filter(generation => !(generation.status === 'APPROVED' && generation.staleAt));
    const activeProducts = (catalog.products || []).filter(item => !item.isSuspended);
    const readyProducts = activeProducts.filter(item => item.product.readiness.eligible);
    const unreadyProducts = activeProducts.filter(item => !item.product.readiness.eligible);
    const termsCount = catalog.termsSections.length || defaults?.termsDocument.sections.length || 0;
    const readiness = [
        { label: 'Approved defaults', ready: Boolean(defaults?.approvedAt && defaults.approvedById) },
        { label: 'Reviewed branding', ready: Boolean(branding?.reviewedAt) },
        { label: 'Structured terms', ready: termsCount > 0 && termsCount <= 12 },
        { label: 'Eligible products', ready: activeProducts.length > 0 && activeProducts.length <= 500 && readyProducts.length === activeProducts.length, detail: `${readyProducts.length}/${activeProducts.length}` },
        { label: 'Catalog available', ready: catalog.status !== 'ARCHIVED' },
    ];
    const isReady = readiness.every(item => item.ready);
    const today = new Date();
    const maximum = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(validUntil) && validUntil > toLocalIsoDate(today) && validUntil <= toLocalIsoDate(maximum);

    const runAction = async (id: string, action: () => Promise<unknown>, success: string) => {
        setBusyId(id);
        try {
            await action();
            toast.success(success);
            await loadGenerations();
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Generation action failed.');
        } finally {
            setBusyId(null);
        }
    };

    const create = () => {
        if (!validDate) {
            toast.error('Valid until must be a future date no more than 30 days away.');
            return;
        }
        void runAction('create', () => service.createGeneration(catalog.id, validUntil), 'Catalog generation queued.');
    };

    const approve = (generation: WholesaleCatalogGeneration) => {
        if (!window.confirm(`Approve wholesale catalog v${generation.versionNumber}? This makes this snapshot the approved internal master.`)) return;
        void runAction(generation.id, () => service.approveGeneration(generation.id, approvalNotes[generation.id]), 'Catalog generation approved.');
    };

    const acknowledgeDownloadedFiles = () => {
        try {
            if (!needsDownloadedArtifactWarning(window.localStorage)) return true;
            if (!window.confirm('Previously downloaded PDF files cannot be updated or revoked. Continue?')) return false;
            recordDownloadedArtifactWarning(window.localStorage);
            return true;
        } catch { return window.confirm('Previously downloaded PDF files cannot be updated or revoked. Continue?'); }
    };

    const extendValidity = (generation: WholesaleCatalogGeneration) => {
        const next = extensionValues[generation.id] || '';
        if (!isValidValidityExtension(generation, next)) { toast.error('Choose a future date no more than 30 days from the original generation date.'); return; }
        if (!acknowledgeDownloadedFiles()) return;
        void runAction(generation.id, () => service.extendGenerationValidity(generation.id, next), 'Validity update queued. The PDF will refresh shortly.');
    };

    const accessArtifact = async (generation: WholesaleCatalogGeneration, mode: 'preview' | 'download') => {
        if (!acknowledgeDownloadedFiles()) return;
        setBusyId(`${mode}-${generation.id}`);
        try {
            const blob = await (mode === 'preview' ? service.previewGeneration(generation.id) : service.downloadGeneration(generation.id));
            const url = URL.createObjectURL(blob);
            if (mode === 'preview') {
                window.open(url, '_blank', 'noopener,noreferrer');
            } else {
                const link = document.createElement('a');
                link.href = url;
                link.download = `wholesale-catalog-v${generation.versionNumber || 'preview'}.pdf`;
                link.click();
            }
            window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Unable to retrieve generated PDF.');
        } finally {
            setBusyId(null);
        }
    };

    return <section className="space-y-5 border-t border-slate-200 pt-7 dark:border-slate-700">
        <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Generate catalog PDF</h3>
            <p className="mt-1 text-sm text-slate-500">The effective date is recorded when the server accepts the request. Product, pricing, terms, and branding are captured as an immutable snapshot at that time.</p>
        </div>

        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error} <button onClick={() => void loadGenerations(true)} className="ml-2 font-semibold underline">Retry</button></div>}
        {loading ? <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="animate-spin" size={18} /> Loading generation readiness...</div> : <>
            <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/60 lg:grid-cols-[1fr_auto]">
                <div>
                    <div className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Readiness summary</div>
                    <div className="flex flex-wrap gap-2">{readiness.map(item => <span key={item.label} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${item.ready ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'}`}>{item.ready ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />}{item.label}{item.detail ? ` ${item.detail}` : ''}</span>)}</div>
                    {unreadyProducts.length > 0 && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                        <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">Products not ready ({unreadyProducts.length})</div>
                        <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto" aria-label="Products not ready">
                            {unreadyProducts.map(item => <li key={item.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                                <span className="font-semibold text-slate-800 dark:text-slate-100">{item.product.name}</span>
                                {item.product.sku && <span className="text-slate-500">SKU: {item.product.sku}</span>}
                                <span className="text-amber-700 dark:text-amber-300">{productReadinessIssues(item.product.readiness).join(', ')}</span>
                            </li>)}
                        </ul>
                    </div>}
                    {!isReady && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">Complete every readiness item before generating.</p>}
                    {hasActiveJob && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">Another catalog generation is currently active for this account.</p>}
                </div>
                {canGenerate ? <div className="flex min-w-56 flex-col justify-end gap-2">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Valid until *<input aria-label="Valid until" required type="date" min={toLocalIsoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1))} max={toLocalIsoDate(maximum)} value={validUntil} onChange={event => setValidUntil(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                    <span className="text-xs text-slate-500">Defaults to seven business days; maximum 30 calendar days.</span>
                    <button disabled={!isReady || !validDate || hasActiveJob || busyId !== null} onClick={create} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busyId === 'create' ? <Loader2 className="animate-spin" size={16} /> : <FileClock size={16} />} Create generation</button>
                </div> : <div className="self-center rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-700 dark:text-slate-300">Generate permission required</div>}
            </div>

            {staleApproved.length > 0 && <GenerationGroup title="Approved but stale" description="These approved PDFs no longer match current catalog data. Generate a new snapshot; retained downloads remain available with warnings and cannot have validity extended." generations={staleApproved} canGenerate={canGenerate} busyId={busyId} approvalNotes={approvalNotes} setApprovalNotes={setApprovalNotes} extensionValues={extensionValues} setExtensionValues={setExtensionValues} onExtend={extendValidity} onApprove={approve} onCancel={generation => void runAction(generation.id, () => service.cancelGeneration(generation.id), 'Cancellation requested.')} onRetry={generation => void runAction(generation.id, () => service.retryGeneration(generation.id), 'Exact snapshot retry queued.')} onArtifact={accessArtifact} stale />}
            {busyId && busyId !== 'create' && <div role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={16} /> Applying generation action...</div>}
            <GenerationGroup title="Generation history" description="Jobs and validity artifact updates refresh every four seconds while visible. Account owners receive the expected reminder two days before validity expires." generations={currentHistory} canGenerate={canGenerate} busyId={busyId} approvalNotes={approvalNotes} setApprovalNotes={setApprovalNotes} extensionValues={extensionValues} setExtensionValues={setExtensionValues} onExtend={extendValidity} onApprove={approve} onCancel={generation => void runAction(generation.id, () => service.cancelGeneration(generation.id), 'Cancellation requested.')} onRetry={generation => void runAction(generation.id, () => service.retryGeneration(generation.id), 'Exact snapshot retry queued.')} onArtifact={accessArtifact} />
        </>}
    </section>;
}

interface GroupProps {
    title: string;
    description: string;
    generations: WholesaleCatalogGeneration[];
    canGenerate: boolean;
    busyId: string | null;
    approvalNotes: Record<string, string>;
    setApprovalNotes: Dispatch<SetStateAction<Record<string, string>>>;
    extensionValues: Record<string, string>;
    setExtensionValues: Dispatch<SetStateAction<Record<string, string>>>;
    onExtend: (generation: WholesaleCatalogGeneration) => void;
    onApprove: (generation: WholesaleCatalogGeneration) => void;
    onCancel: (generation: WholesaleCatalogGeneration) => void;
    onRetry: (generation: WholesaleCatalogGeneration) => void;
    onArtifact: (generation: WholesaleCatalogGeneration, mode: 'preview' | 'download') => void;
    stale?: boolean;
}

function GenerationGroup({ title, description, generations, canGenerate, busyId, approvalNotes, setApprovalNotes, extensionValues, setExtensionValues, onExtend, onApprove, onCancel, onRetry, onArtifact, stale }: GroupProps) {
    return <div className={`rounded-2xl border ${stale ? 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
        <div className="border-b border-inherit p-4"><h4 className="font-semibold text-slate-900 dark:text-white">{title}</h4><p className="mt-1 text-xs text-slate-500">{description}</p></div>
        {!generations.length ? <div className="p-6 text-center text-sm text-slate-500">No generations yet.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="bg-slate-50/80 uppercase tracking-wide text-slate-500 dark:bg-slate-800/80"><tr><th className="p-3">Status / progress</th><th className="p-3">Version</th><th className="p-3">Effective / valid</th><th className="p-3">Pages / products</th><th className="p-3">Creator / approver</th><th className="p-3">Stale / error</th><th className="p-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{generations.map(generation => <tr key={generation.id} className="align-top">
            <td className="p-3"><GenerationBadge generation={generation} /><div className="mt-1 text-slate-500">{generation.progressStage || 'Not started'} / {generation.progressPercent}%</div></td>
            <td className="p-3 font-medium text-slate-700 dark:text-slate-200">{generation.versionNumber ? `v${generation.versionNumber}` : 'Pending'}</td>
            <td className="p-3 text-slate-600 dark:text-slate-300"><div>{formatDate(generation.effectiveDate)}</div><div>to {formatDate(generation.validUntil)}</div><div className="mt-1 font-medium">Artifact: {generation.validityArtifactStatus.toLowerCase()}</div>{canGenerate && canExtendGenerationValidity(generation) && <div className="mt-2 flex gap-1"><input aria-label={`Extend validity for version ${generation.versionNumber}`} type="date" min={toLocalIsoDate(new Date(Date.now() + 86400000))} max={generationValidityMaximum(generation)} value={extensionValues[generation.id] || ''} onChange={event => setExtensionValues(current => ({ ...current, [generation.id]: event.target.value }))} className="w-32 rounded border border-slate-300 bg-white px-1 py-1 dark:border-slate-600 dark:bg-slate-900" /><button type="button" disabled={busyId !== null || !isValidValidityExtension(generation, extensionValues[generation.id] || '')} onClick={() => onExtend(generation)} className="rounded bg-indigo-600 px-2 py-1 font-semibold text-white disabled:opacity-40">Extend</button></div>}</td>
            <td className="p-3 text-slate-600 dark:text-slate-300">{generation.pageCount ?? '-'} pages<br />{generation.productCount} products</td>
            <td className="p-3 text-slate-600 dark:text-slate-300"><div title={generation.requestedById}>By {shortId(generation.requestedById)}</div>{generation.approvedById && <div title={generation.approvedById}>Approved {shortId(generation.approvedById)}</div>}</td>
            <td className="max-w-56 p-3 text-slate-600 dark:text-slate-300">{generation.staleReasons?.map(reason => <div key={`${reason.code}-${reason.changedAt}`}>{staleReasonLabel(reason.code)}</div>)}{generation.warning === 'EXPIRED' && <div className="text-amber-700 dark:text-amber-300">Validity expired</div>}{generation.errorMessage && <div className="text-red-600 dark:text-red-300">{generation.errorMessage}</div>}{!generation.staleReasons?.length && !generation.errorMessage && !generation.warning && '-'}</td>
            <td className="p-3"><div className="flex justify-end gap-1">
                {generation.downloadable && canGenerate && <><button disabled={busyId !== null} onClick={() => onArtifact(generation, 'preview')} title="Internal preview" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"><Eye size={15} /> Internal preview</button><button disabled={busyId !== null} onClick={() => onArtifact(generation, 'download')} title="Download master PDF" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"><Download size={15} /> Master PDF</button></>}
                {isActiveGeneration(generation) && canGenerate && <button disabled={busyId !== null || Boolean(generation.cancelRequestedAt)} onClick={() => onCancel(generation)} title="Cancel generation" className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"><StopCircle size={15} /></button>}
                {canRetryGeneration(generation) && canGenerate && <button disabled={busyId !== null} onClick={() => onRetry(generation)} title="Retry exact snapshot" className="rounded-lg p-2 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"><RefreshCw size={15} /></button>}
            </div>{generation.status === 'AWAITING_APPROVAL' && canGenerate && <div className="mt-2 flex justify-end gap-1"><input aria-label={`Approval note for version ${generation.versionNumber}`} maxLength={2000} placeholder="Optional approval note" value={approvalNotes[generation.id] || ''} onChange={event => setApprovalNotes(current => ({ ...current, [generation.id]: event.target.value }))} className="w-40 rounded-lg border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-900" /><button disabled={busyId !== null} onClick={() => onApprove(generation)} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 font-semibold text-white disabled:opacity-50">Approve</button></div>}</td>
        </tr>)}</tbody></table></div>}
    </div>;
}

function GenerationBadge({ generation }: { generation: WholesaleCatalogGeneration }) {
    const tone = generation.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : generation.status === 'FAILED' || generation.status === 'CANCELLED' || generation.status === 'EXPIRED' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : generation.status === 'AWAITING_APPROVAL' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300';
    return <span className={`inline-flex rounded-full px-2 py-1 font-semibold ${tone}`}>{generationStatusLabel(generation.status)}</span>;
}

function formatDate(value: string) {
    return new Date(value).toLocaleDateString();
}

function shortId(value: string) {
    return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}
