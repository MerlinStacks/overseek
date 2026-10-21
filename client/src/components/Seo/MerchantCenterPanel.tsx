import { isRecord } from '../../utils/responseValidation';

export interface MerchantIssue { severity: 'error' | 'warning'; message: string; attribute?: string }
interface Props { score?: number | null; issues?: MerchantIssue[] | null }
export function MerchantCenterPanel({ score, issues }: Props) {
    const available = typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100 && Array.isArray(issues) && issues.every(issue => isRecord(issue) && ['error', 'warning'].includes(String(issue.severity)) && typeof issue.message === 'string' && (issue.attribute == null || typeof issue.attribute === 'string'));
    return <section aria-label="Merchant Center assessment" className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4 text-slate-900 dark:text-slate-100">
        <h3 className="font-semibold">Google Merchant Center</h3>
        {!available ? <p role="status">Assessment unavailable. Run a product analysis; compliance has not been established.</p> : <>
            <p>Assessment score: {score}/100</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Local checks only. Google approval and sync eligibility are not guaranteed.</p>
            {!issues!.length ? <p>No issues recorded in this assessment.</p> : <ul className="space-y-3">{issues!.map((issue, index) => <li key={index} className={`p-3 rounded-lg ${issue.severity === 'error' ? 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300'}`}><p className="font-semibold">{issue.severity === 'error' ? 'Error' : 'Warning'}{issue.attribute ? ` (${issue.attribute})` : ''}</p><p>{issue.message}</p></li>)}</ul>}
        </>}
    </section>;
}
