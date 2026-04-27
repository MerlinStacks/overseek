import { Modal } from '../ui/Modal';
import { SeoAnalysisPanel } from '../Seo/SeoAnalysisPanel';
import { MerchantCenterPanel } from '../Seo/MerchantCenterPanel';
import type { SeoTest } from '../Seo/SeoAnalysisPanel';
import type { MerchantIssue } from '../Seo/MerchantCenterPanel';

interface ProductSeoModalProps {
    product: {
        name?: string;
        seoScore?: number;
        merchantCenterScore?: number;
        seoData?: {
            analysis?: unknown[];
            focusKeyword?: string;
        };
        merchantCenterIssues?: unknown[];
    } | null;
    isOpen: boolean;
    onClose: () => void;
}

export function ProductSeoModal({ product, isOpen, onClose }: ProductSeoModalProps) {
    if (!product) return null;

    const seoData = product.seoData || {};
    const seoTests = Array.isArray(seoData.analysis)
        ? seoData.analysis.filter((test): test is SeoTest => (
            typeof test === 'object' &&
            test !== null &&
            typeof (test as SeoTest).test === 'string' &&
            typeof (test as SeoTest).passed === 'boolean' &&
            typeof (test as SeoTest).message === 'string'
        ))
        : [];
    const focusKeyword = seoData.focusKeyword || '';

    const mcIssues = Array.isArray(product.merchantCenterIssues)
        ? product.merchantCenterIssues.filter((issue): issue is MerchantIssue => (
            typeof issue === 'object' &&
            issue !== null &&
            ((issue as MerchantIssue).severity === 'error' || (issue as MerchantIssue).severity === 'warning') &&
            typeof (issue as MerchantIssue).message === 'string'
        ))
        : [];

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div>
                    <div className="text-lg font-bold text-gray-900">Product Intelligence</div>
                    <p className="text-sm text-gray-500 font-normal">{product.name}</p>
                </div>
            }
            maxWidth="max-w-4xl"
        >
            {/* Scrollable Content */}
            <div className="bg-gray-50/50 -mx-6 px-6 py-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* SEO Column */}
                    <div className="space-y-4">
                        <SeoAnalysisPanel
                            score={product.seoScore || 0}
                            tests={seoTests}
                            focusKeyword={focusKeyword}
                        />
                    </div>

                    {/* Merchant Center Column */}
                    <div className="space-y-4">
                        <MerchantCenterPanel
                            score={product.merchantCenterScore || 0}
                            issues={mcIssues}
                        />
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="pt-4 mt-4 border-t border-gray-100 flex justify-end -mx-6 px-6">
                <button
                    onClick={onClose}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-medium transition-colors"
                >
                    Close
                </button>
            </div>
        </Modal>
    );
}
