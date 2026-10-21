import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { getDateRange } from '../utils/dateUtils';
import { type ReportResult, type ReportTemplate, DIMENSION_OPTIONS, METRIC_OPTIONS } from '../types/analytics';
import { AnalyticsService } from '../services/AnalyticsService';
import { useScopedMutation } from '../hooks/useScopedMutation';
import { ReportConfigPanel } from './reports/ReportConfigPanel';
import { ReportResults } from './reports/ReportResults';
import { SaveReportModal, type SaveReportPayload } from './reports/SaveReportModal';

interface Props { initialConfig?: ReportTemplate['config']; autoRun?: boolean; viewMode?: boolean; onTemplateSaved?: () => void }
export function ReportBuilder(props: Props) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to build reports.</p>;
    return <ScopedReportBuilder key={JSON.stringify([token, currentAccount.id, props.initialConfig])} {...props} token={token} accountId={currentAccount.id} />;
}
function ScopedReportBuilder({ initialConfig, autoRun = false, viewMode = false, onTemplateSaved, token, accountId }: Props & { token: string; accountId: string }) {
    const [metrics, setMetrics] = useState(initialConfig?.metrics || ['sales']);
    const [dimension, setDimension] = useState(initialConfig?.dimension || 'day');
    const [dateRange, setDateRange] = useState(initialConfig?.dateRange || 'today');
    const config = { metrics, dimension, dateRange }; const configKey = JSON.stringify(config);
    const [report, setReport] = useState<{ key: string; rows: ReportResult[] } | null>(null);
    const [attemptKey, setAttemptKey] = useState('');
    const [validation, setValidation] = useState('');
    const [open, setOpen] = useState(false); const [completed, setCompleted] = useState(false); const [notice, setNotice] = useState('');
    const [saved, setSaved] = useState<{ id: string; name: string; configKey: string } | null>(null);
    const savePending = useRef(false);
    const mutation = useScopedMutation(); const { run, isPending, isActive } = mutation;
    const valid = metrics.length > 0 && metrics.every(metric => METRIC_OPTIONS.some(item => item.value === metric)) && DIMENSION_OPTIONS.some(item => item.value === dimension) && ['today', 'yesterday', '7d', '30d', '90d', 'ytd'].includes(dateRange);
    const generate = useCallback(async () => {
        if (isPending()) return;
        if (!valid) { setValidation('Choose a valid date range, grouping and at least one supported metric.'); return; }
        setValidation('');
        setAttemptKey(configKey); setReport(null);
        const result = await run(signal => {
            const range = getDateRange(dateRange);
            return AnalyticsService.generateReport(token, accountId, { metrics, dimension, startDate: new Date(range.startDate), endDate: new Date(range.endDate) }, { signal });
        }, 'Report unavailable. Retry generation.');
        if (result.ok) setReport({ key: configKey, rows: result.value });
    }, [isPending, valid, run, dateRange, token, accountId, metrics, dimension, configKey]);
    useEffect(() => { let disposed = false; if (autoRun) queueMicrotask(() => { if (!disposed) void generate(); }); return () => { disposed = true; }; }, [autoRun, generate]);
    const save = async (payload: SaveReportPayload, signal?: AbortSignal) => {
        if (savePending.current || !valid || completed) throw new Error('Save unavailable');
        savePending.current = true;
        try {
            let template = saved;
            if (!template) {
                const value = await AnalyticsService.saveTemplate(token, accountId, { name: payload.name, config }, { signal });
                if (!isActive() || signal?.aborted) throw new Error('Save cancelled');
                template = { id: value.id, name: value.name, configKey }; setSaved(template);
            }
            if (template.configKey !== configKey) throw new Error('The saved template uses different settings. Close this dialog and start a new template.');
            if (payload.schedule) await AnalyticsService.createSchedule(token, accountId, { ...payload.schedule, templateId: template.id }, { signal });
            if (!isActive() || signal?.aborted) throw new Error('Save cancelled');
            setCompleted(true);
            try { await onTemplateSaved?.(); } catch { if (isActive()) setNotice('Save confirmed, but the template list could not refresh. Do not repeat the save; reload the reports list.'); }
        } finally { savePending.current = false; }
    };
    const showSave = () => {
        if (mutation.busy || !valid) return;
        if (completed || saved && saved.configKey !== configKey) { setSaved(null); setCompleted(false); }
        setNotice(''); setOpen(true);
    };
    const currentReport = report?.key === configKey;
    return <div className="space-y-5 text-slate-900 dark:text-slate-100">
        <div className="flex flex-col md:flex-row gap-6">
            {!viewMode && <ReportConfigPanel dateRange={dateRange} setDateRange={setDateRange} dimension={dimension} setDimension={setDimension} metrics={metrics} setMetrics={setMetrics} isLoading={mutation.busy || open} onGenerate={() => void generate()} onSaveOpen={showSave} />}
            <div className="min-w-0 flex-1">{mutation.busy && <p role="status">Generating report...</p>}{validation && <p role="alert">{validation}</p>}
                <ReportResults results={currentReport ? report.rows : []} metrics={metrics} dimension={dimension} viewMode={viewMode} error={attemptKey === configKey ? mutation.error : null} hasSearched={!!currentReport || attemptKey === configKey && !!mutation.error} />
            </div>
        </div>
        {notice && <p role="status">{notice}</p>}
        <SaveReportModal isOpen={open} onClose={() => { if (!savePending.current) setOpen(false); }} onSave={save} savedTemplateName={saved?.name} completed={completed} />
    </div>;
}
