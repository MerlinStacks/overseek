import { isRecord } from '../../utils/responseValidation';

export interface SeoTest { test: string; passed: boolean; message: string }
interface Props { score?: number | null; tests?: SeoTest[] | null; focusKeyword?: string; onUpdateKeyword?: (keyword: string) => void }
export function SeoAnalysisPanel({ score, tests, focusKeyword }: Props) {
    const available = typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100 && Array.isArray(tests) && tests.length > 0 && tests.every(test => isRecord(test) && typeof test.test === 'string' && typeof test.passed === 'boolean' && typeof test.message === 'string');
    return <section aria-label="SEO analysis" className="p-6 space-y-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100">
        <h3 className="font-semibold">SEO Health Score</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">Heuristic content checklist, not a prediction of search ranking, traffic or indexing.</p>
        {!available ? <p role="status">SEO assessment unavailable. Sync or analyze this product to generate checks.</p> : <>
            <p className="text-xl font-semibold tabular-nums">{score}/100</p>
            <div role="progressbar" aria-label="SEO health score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score!} className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-[var(--primary-color)] transition-all motion-reduce:transition-none" style={{ width: `${score}%` }} /></div>
            {focusKeyword && <p>Focus keyword: {focusKeyword}</p>}
            {([false, true] as const).map(passed => <div key={String(passed)}><h4 className="font-medium">{passed ? 'Passed Checks' : 'Action Items'} ({tests!.filter(test => test.passed === passed).length})</h4><ul className="space-y-3 mt-2">{tests!.filter(test => test.passed === passed).map((test, index) => <li key={index} className={`p-3 rounded-lg ${passed ? 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300'}`}><p className="font-medium">{test.test}</p><p className="text-sm">{test.message}</p></li>)}</ul></div>)}
        </>}
    </section>;
}
