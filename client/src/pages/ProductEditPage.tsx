/**
 * Product Edit Page
 *
 * Page for editing product details, inventory, pricing, SEO, and sales history.
 * State management delegated to useProductEdit hook.
 */

import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, ExternalLink, RefreshCw, Box, Tag, Package, DollarSign, Layers, Search, FileText, Clock, ShoppingCart, ImageOff, Eye } from 'lucide-react';
import { SeoScoreBadge } from '../components/Seo/SeoScoreBadge';
import { SeoAnalysisPanel } from '../components/Seo/SeoAnalysisPanel';
import { MerchantCenterPanel } from '../components/Seo/MerchantCenterPanel';
import { ProductSearchInsightsPanel } from '../components/Seo/ProductSearchInsightsPanel';
import { MerchantCenterScoreBadge } from '../components/Seo/MerchantCenterScoreBadge';
import { GeneralInfoPanel } from '../components/products/GeneralInfoPanel';
import { LogisticsPanel } from '../components/products/LogisticsPanel';
import { VariationsPanel } from '../components/products/VariationsPanel';
import { PricingPanel } from '../components/products/PricingPanel';
import { BOMPanel } from '../components/products/BOMPanel';
import { WooCommerceInfoPanel } from '../components/products/WooCommerceInfoPanel';
import { GoldPricePanel } from '../components/products/GoldPricePanel';
import { Tabs } from '../components/ui/Tabs';
import { ImageGallery } from '../components/products/ImageGallery';
import { HistoryTimeline } from '../components/shared/HistoryTimeline';
import { ProductSalesHistory } from '../components/products/ProductSalesHistory';
import { Toast } from '../components/ui/Toast';
import { PresenceAvatars } from '../components/common/PresenceAvatars';
import { useProductEdit } from '../hooks/useProductEdit';

export function ProductEditPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const {
        isLoading,
        isSaving,
        isSyncing,
        product,
        formData,
        variants,
        suppliers,
        productViews,
        mainImageFailed,
        toast,
        seoResult,
        activeUsers,
        currentAccount,
        bomPanelRef,
        variationsPanelRef,
        updateFormData,
        setVariants,
        setMainImageFailed,
        hideToast,
        handleSave,
        handleSync,
        fetchProduct
    } = useProductEdit(id);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-50/50">
                <Loader2 className="animate-spin text-blue-600" size={32} />
            </div>
        );
    }

    if (!product) {
        return (
            <div className="p-8 text-center">
                <h2 className="text-xl font-bold text-gray-900">Product Not Found</h2>
                <button onClick={() => navigate('/inventory')} className="mt-4 text-blue-600 hover:underline">
                    Back to Inventory
                </button>
            </div>
        );
    }

    const tabs = [
        {
            id: 'details',
            label: 'General Details',
            icon: <FileText size={16} />,
            content: (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="lg:col-span-2 space-y-6">
                        <GeneralInfoPanel
                            formData={formData}
                            onChange={updateFormData}
                            product={product}
                            suppliers={suppliers}
                        />
                    </div>
                    <div className="space-y-6">
                        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 p-4">
                            {mainImageFailed ? (
                                <div className="w-full h-64 bg-gray-50 rounded-lg flex flex-col items-center justify-center text-gray-400">
                                    <ImageOff size={48} />
                                    <span className="text-sm mt-2">Image unavailable</span>
                                </div>
                            ) : (product.mainImage || formData.images?.[0]?.src) ? (
                                <img
                                    src={product.mainImage || formData.images?.[0]?.src}
                                    alt=""
                                    className="w-full h-auto rounded-lg border border-gray-100 shadow-xs"
                                    referrerPolicy="no-referrer"
                                    onError={() => setMainImageFailed(true)}
                                />
                            ) : (
                                <div className="w-full h-64 bg-gray-50 rounded-lg flex items-center justify-center text-gray-400">
                                    <Box size={48} />
                                </div>
                            )}
                        </div>
                        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 p-6">
                            <ImageGallery
                                images={formData.images || []}
                                onChange={(imgs) => updateFormData({ images: imgs })}
                            />
                        </div>
                        <WooCommerceInfoPanel categories={product.categories || []} tags={product.tags || []} />
                    </div>
                </div>
            )
        },
        {
            id: 'pricing',
            label: 'Pricing & Values',
            icon: <DollarSign size={16} />,
            content: (
                <div className="max-w-4xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <PricingPanel formData={formData} onChange={updateFormData} />
                    <GoldPricePanel
                        product={{ ...product, isGoldPriceApplied: formData.isGoldPriceApplied }}
                        onChange={updateFormData}
                        hasVariants={!!(product.variations?.length)}
                    />
                </div>
            )
        },
        {
            id: 'logistics',
            label: 'Inventory & Shipping',
            icon: <Package size={16} />,
            content: (
                <div className="max-w-4xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <LogisticsPanel
                        formData={formData}
                        productWooId={product.wooId}
                        weightUnit={currentAccount?.weightUnit}
                        dimensionUnit={currentAccount?.dimensionUnit}
                        variants={variants}
                        onChange={updateFormData}
                    />
                    {!product.type?.includes('variable') && !product.variations?.length && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
                            <BOMPanel
                                ref={bomPanelRef}
                                productId={product.id}
                                variants={[]}
                                fixedVariationId={0}
                                onSaveComplete={() => fetchProduct(true)}
                                onCOGSUpdate={(cogs) => updateFormData({ cogs: cogs.toFixed(2) })}
                            />
                        </div>
                    )}
                </div>
            )
        },
        ...((product.type?.includes('variable') || product.variations?.length) && product.variations?.length ? [{
            id: 'variants',
            label: 'Variations',
            icon: <Layers size={16} />,
            content: (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <VariationsPanel
                        ref={variationsPanelRef}
                        product={product}
                        variants={variants}
                        onUpdate={setVariants}
                    />
                </div>
            )
        }] : []),
        {
            id: 'seo',
            label: 'SEO & Discovery',
            icon: <Search size={16} />,
            content: (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* Search Console Insights — full width hero */}
                    <ProductSearchInsightsPanel permalink={product.permalink} />

                    {/* SEO Health + Merchant Center — two-column grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="space-y-6">
                            <div className="bg-white/70 dark:bg-slate-800/60 backdrop-blur-md rounded-xl shadow-xs border border-white/50 dark:border-slate-700/40 p-6">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100 uppercase tracking-wide">SEO Health</h3>
                                    <SeoScoreBadge score={seoResult.score || 0} size="md" tests={seoResult.tests} />
                                </div>
                                <SeoAnalysisPanel score={seoResult.score} tests={seoResult.tests} focusKeyword={formData.focusKeyword} />
                                <div className="mt-6 pt-6 border-t border-gray-100/50 dark:border-slate-700/40">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Focus Keyword</label>
                                    <input
                                        type="text"
                                        value={formData.focusKeyword}
                                        onChange={(e) => updateFormData({ focusKeyword: e.target.value })}
                                        className="w-full px-4 py-2 bg-white/50 dark:bg-slate-700/40 border border-gray-200 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all dark:text-slate-200"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="space-y-6">
                            <div className="bg-white/70 dark:bg-slate-800/60 backdrop-blur-md rounded-xl shadow-xs border border-white/50 dark:border-slate-700/40 p-6">
                                <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100 uppercase tracking-wide mb-4">Merchant Center Status</h3>
                                <MerchantCenterPanel score={product.merchantCenterScore || 0} issues={product.merchantCenterIssues || []} />
                            </div>
                        </div>
                    </div>
                </div>
            )
        },
        {
            id: 'sales',
            label: 'Sales History',
            icon: <ShoppingCart size={16} />,
            content: (
                <div className="max-w-5xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <ProductSalesHistory productWooId={product.wooId} />
                </div>
            )
        },
        {
            id: 'history',
            label: 'Edit History',
            icon: <Clock size={16} />,
            content: (
                <div className="max-w-4xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <HistoryTimeline resource="PRODUCT" resourceId={product.wooId.toString()} />
                </div>
            )
        }
    ];

    return (
        <div className="min-h-screen bg-gray-50/50 pb-20">
            {/* Header Sticky Bar */}
            <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 shadow-xs transition-all">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <button onClick={() => navigate('/inventory')} className="p-2 hover:bg-gray-100/80 rounded-full text-gray-500 transition-colors">
                                <ArrowLeft size={20} />
                            </button>
                            <div>
                                <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                    {product.name}
                                    <span className={`text-xs px-2 py-0.5 rounded-full border ${product.stockStatus === 'instock' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                        {product.stockStatus === 'instock' ? 'In Stock' : 'Out of Stock'}
                                    </span>
                                </h1>
                                <div className="flex items-center gap-3 mt-1">
                                    <SeoScoreBadge score={seoResult.score || 0} size="sm" tests={seoResult.tests} />
                                    <MerchantCenterScoreBadge score={product.merchantCenterScore || 0} size="sm" issues={product.merchantCenterIssues} />
                                </div>
                                <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
                                    <span className="font-mono bg-gray-100/80 px-2 py-0.5 rounded-sm text-xs text-gray-600">ID: {product.wooId}</span>
                                    {product.sku && <span className="flex items-center gap-1"><Tag size={12} /> {product.sku}</span>}
                                    {productViews && (
                                        <span className="flex items-center gap-1 text-purple-600" title={`${productViews.views30d} views in 30 days`}>
                                            <Eye size={12} />
                                            <span className="font-medium">{productViews.views7d}</span>
                                            <span className="text-gray-400">7d</span>
                                            <span className="text-gray-300">|</span>
                                            <span className="font-medium">{productViews.views30d}</span>
                                            <span className="text-gray-400">30d</span>
                                        </span>
                                    )}
                                    <span>•</span>
                                    <a href={product.permalink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600 hover:text-blue-800 transition-colors">
                                        View on Store <ExternalLink size={12} />
                                    </a>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <PresenceAvatars users={activeUsers} currentUserId={currentAccount?.id} />
                            <div className="h-8 w-px bg-gray-300 mx-2 hidden sm:block"></div>
                            <button
                                onClick={handleSync}
                                disabled={isSyncing || isLoading}
                                className="flex items-center gap-2 px-4 py-2 bg-white/50 border border-gray-300/80 text-gray-700 font-medium rounded-lg hover:bg-white transition-colors backdrop-blur-xs disabled:opacity-50"
                            >
                                {isSyncing ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                                <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Sync'}</span>
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="flex items-center gap-2 px-6 py-2 bg-blue-600/90 text-white font-medium rounded-lg hover:bg-blue-600 shadow-md shadow-blue-500/20 disabled:opacity-50 transition-all backdrop-blur-xs"
                            >
                                {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <Tabs tabs={tabs} />
            </div>

            <Toast
                message={toast.message}
                isVisible={toast.isVisible}
                type={toast.type}
                onClose={hideToast}
            />
        </div>
    );
}
