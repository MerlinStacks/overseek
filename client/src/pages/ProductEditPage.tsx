/**
 * Product Edit Page
 *
 * Page for editing product details, inventory, pricing, SEO, and sales history.
 * State management delegated to useProductEdit hook.
 */

import { useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Save, Loader2, ExternalLink, RefreshCw, Box, Tag, Package, DollarSign, Layers, Search, FileText, Clock, ShoppingCart, ImageOff, Eye, Trash2, AlertTriangle, CheckCircle2, CircleDot } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '../context/AuthContext';
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
import { PresenceAvatars } from '../components/common/PresenceAvatars';
import { useProductEdit } from '../hooks/useProductEdit';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import type { MerchantIssue } from '../components/Seo/MerchantCenterPanel';
import type { MerchantCenterIssue } from '../components/Seo/MerchantCenterScoreBadge';
import type { ProductVariant as VariantType } from '../components/products/variantTypes';

type SupplierOption = { id: string; name: string };
type GalleryImage = { id: string | number; src: string; alt?: string };
type MiscCost = { amount: number; note: string };
type GoldPriceType = '18ct' | '9ct' | '18ctWhite' | '9ctWhite' | 'legacy' | null;

export function ProductEditPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const { user } = useAuth();

    const {
        isLoading,
        isSaving,
        isSyncing,
        loadError,
        hasUnsavedChanges,
        saveState,
        saveMessage,
        lastSavedAt,
        lastSyncedAt,
        product,
        formData,
        variants,
        suppliers,
        productViews,
        mainImageFailed,
        seoResult,
        activeUsers,
        currentAccount,
        bomPanelRef,
        variationsPanelRef,
        stockPanelRef,
        updateFormData,
        setVariants,
        setMainImageFailed,
        handleSave,
        handleSync,
        fetchProduct,
        fetchViews,
        discardDraft,
        hasDraft
    } = useProductEdit(id);

    const activeTabParam = searchParams.get('tab');

    if (isLoading) {
        return <ProductEditSkeleton />;
    }

    if (!product) {
        return (
            <div className="p-8 text-center">
                <h2 className="text-xl font-bold text-gray-900">{loadError ? 'Unable to Load Product' : 'Product Not Found'}</h2>
                <p className="mt-2 text-sm text-gray-500">
                    {loadError || 'This product could not be found for the selected account.'}
                </p>
                <div className="mt-4 flex items-center justify-center gap-4">
                    {loadError && (
                        <button onClick={() => fetchProduct()} className="text-blue-600 hover:underline">
                            Try Again
                        </button>
                    )}
                    <button onClick={() => navigate('/inventory')} className="text-blue-600 hover:underline">
                        Back to Inventory
                    </button>
                </div>
            </div>
        );
    }

    const previewImage = (formData.images as Array<{ src?: string }> | undefined)?.[0]?.src || product.mainImage;
    const statusTone = saveState === 'error'
        ? 'text-red-700 bg-red-50 border-red-200'
        : saveState === 'partial'
            ? 'text-amber-700 bg-amber-50 border-amber-200'
            : saveState === 'saved'
                ? 'text-green-700 bg-green-50 border-green-200'
                : saveState === 'saving'
                    ? 'text-blue-700 bg-blue-50 border-blue-200'
                    : 'text-slate-700 bg-slate-50 border-slate-200';
    const statusIcon = saveState === 'error'
        ? <AlertTriangle size={14} />
        : saveState === 'partial'
            ? <AlertTriangle size={14} />
            : saveState === 'saved'
                ? <CheckCircle2 size={14} />
                : saveState === 'saving'
                    ? <Loader2 size={14} className="animate-spin" />
                    : <CircleDot size={14} />;
    const savedLabel = lastSavedAt
        ? `Saved ${formatDistanceToNow(lastSavedAt, { addSuffix: true })}`
        : null;
    const lastSyncLabel = lastSyncedAt
        ? `Synced ${formatDistanceToNow(lastSyncedAt, { addSuffix: true })}`
        : null;
    const saveDisabled = isSaving || isSyncing;

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
                            suppliers={suppliers as unknown as SupplierOption[]}
                        />
                    </div>
                    <div className="space-y-6">
                        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 p-4">
                            {mainImageFailed ? (
                                <div className="w-full h-64 bg-gray-50 rounded-lg flex flex-col items-center justify-center text-gray-400">
                                    <ImageOff size={48} />
                                    <span className="text-sm mt-2">Image unavailable</span>
                                </div>
                            ) : previewImage ? (
                                <img
                                    src={previewImage}
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
                                images={(formData.images as unknown as GalleryImage[]) || []}
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
                    <PricingPanel
                        formData={{
                            price: formData.price,
                            salePrice: formData.salePrice,
                            cogs: formData.cogs,
                            miscCosts: (formData.miscCosts as unknown as MiscCost[]) || []
                        }}
                        onChange={updateFormData}
                    />
                    <GoldPricePanel
                        product={{ ...product, isGoldPriceApplied: formData.isGoldPriceApplied, goldPriceType: (formData.goldPriceType as GoldPriceType), weight: formData.weight }}
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
                        variants={variants as unknown as Array<{ id: number; sku?: string; attributes?: Array<{ name: string; option: string }>; stock_quantity?: number | null; stock_status?: string }>}
                        onChange={updateFormData}
                        stockPanelRef={stockPanelRef}
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
                        product={{ ...product, variations: ((product.variations || []).map((variant) => typeof variant === 'number' ? variant : variant.id)) }}
                        variants={variants as unknown as VariantType[]}
                        onUpdate={(updatedVariants) => setVariants(updatedVariants as unknown[])}
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
                                <MerchantCenterPanel score={product.merchantCenterScore || 0} issues={(product.merchantCenterIssues as MerchantIssue[]) || []} />
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

    const tabIds = useMemo(() => tabs.map(tab => tab.id), [tabs]);
    const activeTab = tabIds.includes(activeTabParam || '') ? (activeTabParam as string) : tabIds[0];

    useEffect(() => {
        if (activeTabParam !== activeTab) {
            const next = new URLSearchParams(searchParams);
            next.set('tab', activeTab);
            setSearchParams(next, { replace: true });
        }
    }, [activeTab, activeTabParam, searchParams, setSearchParams]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
            event.preventDefault();
            if (!isSaving) {
                handleSave();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleSave, isSaving]);

    const handleTabChange = (tabId: string) => {
        const next = new URLSearchParams(searchParams);
        next.set('tab', tabId);
        setSearchParams(next, { replace: true });
    };

    return (
        <div className="min-h-screen bg-gray-50/50 pb-20">
            {/* Header Sticky Bar */}
            <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 shadow-xs transition-all">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <Breadcrumbs items={[
                        { label: 'Inventory', href: '/inventory' },
                        { label: product.name }
                    ]} />
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div>
                                <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                    {product.name}
                                    <span className={`text-xs px-2 py-0.5 rounded-full border ${formData.stockStatus === 'instock' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                        {formData.stockStatus === 'instock' ? 'In Stock' : 'Out of Stock'}
                                    </span>
                                </h1>
                                <div className="flex items-center gap-3 mt-1">
                                    <SeoScoreBadge score={seoResult.score || 0} size="sm" tests={seoResult.tests} />
                                    <MerchantCenterScoreBadge score={product.merchantCenterScore || 0} size="sm" issues={product.merchantCenterIssues as MerchantCenterIssue[] | undefined} />
                                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${statusTone}`}>
                                        {statusIcon}
                                        {hasUnsavedChanges ? 'Unsaved changes' : savedLabel || 'All changes saved'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
                                    <span className="font-mono bg-gray-100/80 px-2 py-0.5 rounded-sm text-xs text-gray-600">ID: {product.wooId}</span>
                                    {formData.sku && <span className="flex items-center gap-1"><Tag size={12} /> {formData.sku}</span>}
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
                                    {lastSyncLabel && (
                                        <>
                                            <span>â€¢</span>
                                            <span>{lastSyncLabel}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <PresenceAvatars users={activeUsers} currentUserId={user?.id} />
                            <div className="h-8 w-px bg-gray-300 mx-2 hidden sm:block"></div>
                            <button
                                onClick={handleSync}
                                disabled={isSyncing || isLoading}
                                className="flex items-center gap-2 px-4 py-2 bg-white/50 border border-gray-300/80 text-gray-700 font-medium rounded-lg hover:bg-white transition-colors backdrop-blur-xs disabled:opacity-50"
                            >
                                {isSyncing ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                                <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Sync'}</span>
                            </button>
                            {hasDraft && (
                                <button
                                    onClick={discardDraft}
                                    className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 text-red-700 font-medium rounded-lg hover:bg-red-100 transition-colors backdrop-blur-xs"
                                    title="Discard restored draft and reset to saved version"
                                >
                                    <Trash2 size={18} />
                                    <span className="hidden sm:inline">Discard Draft</span>
                                </button>
                            )}
                            <button
                                onClick={fetchViews}
                                disabled={saveDisabled}
                                className="hidden sm:flex items-center gap-2 px-3 py-2 bg-white/50 border border-gray-300/80 text-gray-700 font-medium rounded-lg hover:bg-white transition-colors backdrop-blur-xs disabled:opacity-50"
                                title="Refresh product views"
                            >
                                <Eye size={16} />
                                Views
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saveDisabled}
                                className="flex items-center gap-2 px-6 py-2 bg-blue-600/90 text-white font-medium rounded-lg hover:bg-blue-600 shadow-md shadow-blue-500/20 disabled:opacity-50 transition-all backdrop-blur-xs"
                            >
                                {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                                {isSaving ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
                <div className={`rounded-xl border px-4 py-3 text-sm ${statusTone}`}>
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2 font-medium">
                            {statusIcon}
                            <span>{saveMessage || (hasUnsavedChanges ? 'You have unsaved changes.' : 'All product changes are saved.')}</span>
                        </div>
                        <div className="text-xs opacity-80">
                            <span>Shortcut: Ctrl/Cmd+S</span>
                            {savedLabel && <span className="ml-3">{savedLabel}</span>}
                        </div>
                    </div>
                </div>

                <Tabs
                    tabs={tabs}
                    mountInactiveTabs={false}
                    activeTab={activeTab}
                    onTabChange={handleTabChange}
                />
            </div>

            <div className="sm:hidden fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-xl">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-900">
                            {hasUnsavedChanges ? 'Unsaved changes' : savedLabel || 'All changes saved'}
                        </div>
                        <div className="truncate text-xs text-gray-500">
                            {lastSyncLabel || 'Sync when you want the latest WooCommerce data'}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleSync}
                            disabled={isSyncing || isLoading}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
                        >
                            {isSyncing ? 'Syncing...' : 'Sync'}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saveDisabled}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                            {isSaving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            </div>

        </div>
    );
}

function ProductEditSkeleton() {
    return (
        <div className="min-h-screen bg-gray-50/50 pb-20">
            <div className="sticky top-0 z-30 border-b border-gray-200/50 bg-white/80 backdrop-blur-xl shadow-xs">
                <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
                    <div className="h-4 w-48 animate-pulse rounded bg-gray-200" />
                    <div className="mt-4 flex items-center justify-between gap-4">
                        <div className="space-y-3">
                            <div className="h-8 w-72 animate-pulse rounded bg-gray-200" />
                            <div className="h-4 w-64 animate-pulse rounded bg-gray-100" />
                        </div>
                        <div className="flex gap-3">
                            {[1, 2, 3].map(item => (
                                <div key={item} className="h-10 w-24 animate-pulse rounded-lg bg-gray-200" />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
                <div className="h-12 animate-pulse rounded-2xl bg-gray-200" />
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="lg:col-span-2 space-y-6">
                        {[1, 2, 3].map(item => (
                            <div key={item} className="h-40 animate-pulse rounded-xl bg-white" />
                        ))}
                    </div>
                    <div className="space-y-6">
                        <div className="h-72 animate-pulse rounded-xl bg-white" />
                        <div className="h-48 animate-pulse rounded-xl bg-white" />
                    </div>
                </div>
            </div>
        </div>
    );
}
