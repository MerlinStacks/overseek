import { Modal } from '../ui/Modal';
import { SeoAnalysisPanel } from '../Seo/SeoAnalysisPanel';
import { MerchantCenterPanel } from '../Seo/MerchantCenterPanel';

interface ProductSeoModalProps {
    product: any; // We'll type this better
    isOpen: boolean;
    onClose: () => void;
}

export function ProductSeoModal({ product, isOpen, onClose }: ProductSeoModalProps) {
    if (!product) return null;

    const seoData = product.seoData || {};
    const seoTests = seoData.analysis || [];
    const focusKeyword = seoData.focusKeyword || '';

    const mcIssues = product.merchantCenterIssues || [];

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
