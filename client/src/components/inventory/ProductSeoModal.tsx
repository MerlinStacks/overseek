import { Modal } from '../ui/Modal';
import type { SeoTest } from '../Seo/SeoAnalysisPanel';
import type { MerchantIssue } from '../Seo/MerchantCenterPanel';
import { isRecord } from '../../utils/responseValidation';

interface Props {
    product: { name?: string; seoScore?: number; merchantCenterScore?: number; seoData?: { analysis?: unknown[]; focusKeyword?: string }; merchantCenterIssues?: unknown[] } | null;
    isOpen: boolean; onClose: () => void;
}
const validScore = (score: unknown): score is number => typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;
const seoTest = (value: unknown): value is SeoTest => isRecord(value) && typeof value.test === 'string' && typeof value.passed === 'boolean' && typeof value.message === 'string';
const merchantIssue = (value: unknown): value is MerchantIssue => isRecord(value) && ['error', 'warning'].includes(String(value.severity)) && typeof value.message === 'string' && (value.attribute == null || typeof value.attribute === 'string');

export function ProductSeoModal({ product, isOpen, onClose }: Props) {
    if (!product || !isOpen) return null;
    const tests = product.seoData?.analysis;
    const issues = product.merchantCenterIssues;
    const seoAvailable = validScore(product.seoScore) && Array.isArray(tests) && tests.every(seoTest);
    const merchantAvailable = validScore(product.merchantCenterScore) && Array.isArray(issues) && issues.every(merchantIssue);
    return <Modal isOpen onClose={onClose} title="Product Intelligence" maxWidth="max-w-4xl">
        <div className="space-y-4 text-slate-900 dark:text-slate-100"><p className="text-sm text-slate-500 dark:text-slate-400">{product.name}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <section aria-label="SEO assessment" className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 space-y-3"><h2 className="font-semibold">SEO Health Score</h2>
                    {!seoAvailable ? <p role="status">SEO assessment unavailable. Run a product analysis to obtain a score.</p> : <><p className="text-2xl font-semibold">{product.seoScore}/100</p>{typeof product.seoData?.focusKeyword === 'string' && product.seoData.focusKeyword && <p>Focus keyword: {product.seoData.focusKeyword}</p>}<ul className="space-y-2">{tests.map((test, index) => <li key={index}><p className={test.passed ? 'text-green-700 dark:text-green-400' : 'text-amber-800 dark:text-amber-300'}>{test.passed ? 'Passed' : 'Needs attention'}: {test.test}</p><p className="text-sm">{test.message}</p></li>)}</ul>{!tests.length && <p>No individual SEO tests recorded.</p>}</>}
                </section>
                <section aria-label="Merchant Center assessment" className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 space-y-3"><h2 className="font-semibold">Google Merchant Center</h2>
                    {!merchantAvailable ? <p role="status">Merchant Center assessment unavailable. Compliance has not been established.</p> : <><p className="text-2xl font-semibold">{product.merchantCenterScore}/100</p>{issues.length ? <ul className="space-y-2">{issues.map((issue, index) => <li key={index}><p className="font-medium">{issue.severity === 'error' ? 'Error' : 'Warning'}{issue.attribute ? ` (${issue.attribute})` : ''}</p><p className="text-sm">{issue.message}</p></li>)}</ul> : <p>No issues recorded in this assessment.</p>}</>}
                </section>
            </div><div className="flex justify-end"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700">Close</button></div>
        </div>
    </Modal>;
}
