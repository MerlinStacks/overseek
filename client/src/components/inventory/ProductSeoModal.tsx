import { X } from 'lucide-react';
import { SeoAnalysisPanel } from '../Seo/SeoAnalysisPanel';
import { MerchantCenterPanel } from '../Seo/MerchantCenterPanel';

interface ProductSeoModalProps {
    product: any; // We'll type this better
    onClose: () => void;
}

export function ProductSeoModal({ product, onClose }: ProductSeoModalProps) {
    if (!product) return null;

    const seoData = product.seoData || {};
    const seoTests = seoData.analysis || [];
    const focusKeyword = seoData.focusKeyword || '';

    const mcIssues = product.merchantCenterIssues || [];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-100">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">Product Intelligence</h2>
                        <p className="text-sm text-gray-500">{product.name}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
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
                <div className="p-4 border-t border-gray-100 bg-white flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-medium transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
