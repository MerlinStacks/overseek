import { Trophy } from 'lucide-react';
import { ScoreBadgeDetails } from './ScoreBadgeDetails';
import { normalizedScore, scoreBadgeColor, scoreBadgeSizes } from './scoreBadgeUtils';

export interface SeoTest { test: string; passed: boolean; message: string; }
interface SeoScoreBadgeProps { score: number; size?: 'sm' | 'md' | 'lg'; tests?: SeoTest[]; interactive?: boolean; }

export function SeoScoreBadge({ score, size = 'md', tests, interactive }: SeoScoreBadgeProps) {
    const value = normalizedScore(score);
    const checks = Array.isArray(tests) ? tests.filter(test => test && typeof test.test === 'string' && typeof test.passed === 'boolean') : [];
    const failed = checks.filter(test => !test.passed);
    const passed = checks.filter(test => test.passed);
    return <ScoreBadgeDetails interactive={interactive} label={value == null ? 'SEO score unavailable' : `SEO score ${value} out of 100`}
        className={`inline-flex items-center gap-1.5 font-semibold rounded-full border ${scoreBadgeColor(value)} ${scoreBadgeSizes[size]}`}
        details={<>
            <h4 className="font-bold uppercase tracking-wide">SEO analysis</h4>
            {!checks.length && <p>No SEO analysis available.</p>}
            {failed.length > 0 && <p className="font-semibold text-red-700 dark:text-red-300">Fixes needed ({failed.length})</p>}
            {failed.map((test, i) => <p key={`failed-${i}`} className="text-red-700 dark:text-red-300"><strong>{test.test}:</strong> {test.message}</p>)}
            {passed.length > 0 && <p className="font-semibold text-green-700 dark:text-green-300">Passed ({passed.length})</p>}
            {passed.map((test, i) => <p key={`passed-${i}`} className="text-green-700 dark:text-green-300">{test.test}</p>)}
        </>}>
        <Trophy aria-hidden="true" size={size === 'sm' ? 12 : 14} />{value == null ? 'N/A' : `${value}/100`}
    </ScoreBadgeDetails>;
}
