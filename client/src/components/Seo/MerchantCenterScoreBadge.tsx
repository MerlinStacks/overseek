import { ShoppingBag, AlertTriangle } from 'lucide-react';
import { ScoreBadgeDetails } from './ScoreBadgeDetails';
import { normalizedScore, scoreBadgeColor, scoreBadgeSizes } from './scoreBadgeUtils';

export interface MerchantCenterIssue {
    severity: 'error' | 'warning'; message: string; attribute?: string;
}
interface MerchantCenterScoreBadgeProps {
    score: number; size?: 'sm' | 'md' | 'lg'; issues?: MerchantCenterIssue[]; interactive?: boolean;
}

export function MerchantCenterScoreBadge({ score, size = 'md', issues, interactive }: MerchantCenterScoreBadgeProps) {
    const value = normalizedScore(score);
    const available = Array.isArray(issues);
    const validIssues = available ? issues.filter(issue => issue && (issue.severity === 'error' || issue.severity === 'warning') && typeof issue.message === 'string') : [];
    const errors = validIssues.filter(issue => issue.severity === 'error');
    const warnings = validIssues.filter(issue => issue.severity === 'warning');
    const malformed = available && validIssues.length !== issues.length;
    return <ScoreBadgeDetails interactive={interactive} label={value == null ? 'Merchant Center score unavailable' : `Merchant Center score ${value} out of 100`}
        className={`inline-flex items-center gap-1.5 font-semibold rounded-full border ${scoreBadgeColor(value)} ${scoreBadgeSizes[size]}`}
        details={<>
            <h4 className="font-bold uppercase tracking-wide">Merchant Center local checks</h4>
            {!available || (malformed && !validIssues.length) ? <p>No usable Merchant Center analysis available.</p> : validIssues.length === 0 ? <p>No issues reported by the local checks.</p> : <>
                {errors.length > 0 && <p className="font-semibold text-red-700 dark:text-red-300">Critical ({errors.length})</p>}
                {errors.map((issue, i) => <p key={`error-${i}`} className="text-red-700 dark:text-red-300"><AlertTriangle aria-hidden="true" size={12} className="inline mr-1" />{issue.attribute && <strong>{issue.attribute}: </strong>}{issue.message}</p>)}
                {warnings.length > 0 && <p className="font-semibold text-yellow-700 dark:text-yellow-300">Warnings ({warnings.length})</p>}
                {warnings.map((issue, i) => <p key={`warning-${i}`} className="text-yellow-700 dark:text-yellow-300">{issue.attribute && <strong>{issue.attribute}: </strong>}{issue.message}</p>)}
            </>}
            {malformed && validIssues.length > 0 && <p>Some analysis results could not be displayed.</p>}
            <p className="text-gray-500 dark:text-slate-400">Local checks do not guarantee Google Merchant Center approval or sync readiness.</p>
        </>}>
        <ShoppingBag aria-hidden="true" size={size === 'sm' ? 12 : 14} />MC: {value == null ? 'N/A' : `${value}/100`}
    </ScoreBadgeDetails>;
}
