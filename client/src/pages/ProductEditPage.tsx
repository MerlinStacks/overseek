
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, ExternalLink, RefreshCw, Box, Tag, Package, DollarSign, Layers, Search, FileText, Clock, ShoppingCart, ImageOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { SeoScoreBadge } from '../components/Seo/SeoScoreBadge';
import { SeoAnalysisPanel } from '../components/Seo/SeoAnalysisPanel';
import { MerchantCenterPanel } from '../components/Seo/MerchantCenterPanel';
import { GeneralInfoPanel } from '../components/products/GeneralInfoPanel';
import { LogisticsPanel } from '../components/products/LogisticsPanel';
import { VariationsPanel } from '../components/products/VariationsPanel';
import { PricingPanel } from '../components/products/PricingPanel';
import { BOMPanel, BOMPanelRef } from '../components/products/BOMPanel';
import { WooCommerceInfoPanel } from '../components/products/WooCommerceInfoPanel';
import { GoldPricePanel } from '../components/products/GoldPricePanel';
import { Tabs } from '../components/ui/Tabs';
import { ImageGallery } from '../components/products/ImageGallery';
import { HistoryTimeline } from '../components/shared/HistoryTimeline';
import { ProductSalesHistory } from '../components/products/ProductSalesHistory';
import { Logger } from '../utils/logger';

// Services
import { ProductService } from '../services/ProductService';
import { InventoryService } from '../services/InventoryService';

interface ProductData {
    id: string;
    wooId: number;
    name: string;
    sku: string;
    permalink: string;
    description: string;
    short_description: string;
    price: string;
    regularPrice: string;
    salePrice: string;
    stockStatus: string;
    stockQuantity: number | null;
    manageStock: boolean;
    weight: string;
    dimensions: {
        length: string;
        width: string;
        height: string;
    };
    binLocation?: string;
    mainImage?: string;

    // Intelligence
    seoScore?: number;
    seoData?: any;
    merchantCenterScore?: number;
    merchantCenterIssues?: any;

    // COGS & Supplier
    cogs?: string; // Decimal as string for input
    miscCosts?: any[];
    supplierId?: string;
    images?: any[];

    // Gold Price
    isGoldPriceApplied?: boolean;

    // Woo Specific
    type?: 'simple' | 'variable' | 'grouped' | 'external';
    variations?: number[]; // IDs
    rawData?: any;

    // WooCommerce taxonomy & inventory
    categories?: { id: number; name: string; slug: string }[];
    tags?: { id: number; name: string; slug: string }[];
}

interface ProductVariant {
    id: number;
    sku: string;
    price: string;
    attributes: any[];
}

import { MerchantCenterScoreBadge } from '../components/Seo/MerchantCenterScoreBadge';

import { PresenceAvatars } from '../components/common/PresenceAvatars';
import { useCollaboration } from '../hooks/useCollaboration';
import { calculateSeoScore } from '../utils/seoScoring';

export function ProductEditPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    // Presence
    const { activeUsers } = useCollaboration(id || '');

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [product, setProduct] = useState<ProductData | null>(null);

    // Ref to BOMPanel for triggering save from parent
    const bomPanelRef = useRef<BOMPanelRef>(null);

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        sku: '',
        price: '',
        salePrice: '',
        stockStatus: 'instock',
        description: '',
        short_description: '',
        focusKeyword: '',
        isGoldPriceApplied: false,
        weight: '',
        length: '',
        width: '',
        height: '',
        cogs: '',
        miscCosts: [] as any[],
        supplierId: '',
        binLocation: '',
        images: [] as any[]
    });

    const [variants, setVariants] = useState<any[]>([]); // Changed to any for flexibility with new fields
    const [suppliers, setSuppliers] = useState<any[]>([]);
    const [isLoadingVariants, setIsLoadingVariants] = useState(false);
    const [mainImageFailed, setMainImageFailed] = useState(false);

    // Derived SEO Search - Real-time!
    const seoResult = calculateSeoScore({
        name: formData.name,
        description: (formData.description || '') + (formData.short_description || ''),
        permalink: product?.permalink || '', // Permalink usually doesn't change live unless we have a slug editor, but using product's for now
        images: formData.images,
        price: formData.price
    }, formData.focusKeyword);

    useEffect(() => {
        if (!currentAccount) return;
        fetchSuppliers();
    }, [currentAccount, token]);

    useEffect(() => {
        if (!currentAccount || !id) return;
        fetchProduct();
    }, [currentAccount, id, token]);

    const fetchProduct = async () => {
        if (!currentAccount || !token || !id) return;
        setIsLoading(true);
        try {
            const data = await ProductService.getProduct(id, token, currentAccount.id);
            Logger.debug('Product data loaded', { productId: id, wooId: data.wooId });
            setProduct(data);
            setMainImageFailed(false); // Reset image error state for new product
            setFormData({
                name: data.name || '',
                sku: data.sku || '',
                price: data.price ? data.price.toString() : '',
                salePrice: data.salePrice ? data.salePrice.toString() : '',
                stockStatus: data.stockStatus || 'instock',
                binLocation: data.binLocation || '',
                description: data.description || '',
                short_description: data.short_description || '',
                focusKeyword: (data.seoData?.focusKeyword) ? data.seoData.focusKeyword : (data.name || ''),
                isGoldPriceApplied: data.isGoldPriceApplied || false,
                weight: data.weight ? data.weight.toString() : '',
                length: data.dimensions?.length?.toString() || '',
                width: data.dimensions?.width?.toString() || '',
                height: data.dimensions?.height?.toString() || '',
                cogs: data.cogs ? data.cogs.toString() : '',
                miscCosts: data.miscCosts || [],
                supplierId: data.supplierId || '',
                images: data.images || []
            });

            // Load variants if present
            if (data.variations && data.variations.length > 0) {
                // Check if it's full objects or just IDs
                if (typeof data.variations[0] === 'object') {
                    setVariants(data.variations);
                } else {
                    // Fallback dummy (shouldn't happen with new backend)
                    fetchVariants(data.variations);
                }
            }
        } catch (error) {
            console.error('Failed to load product', error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchSuppliers = async () => {
        if (!currentAccount || !token) return;
        try {
            const data = await InventoryService.getSuppliers(token, currentAccount.id);
            setSuppliers(data);
        } catch (e) {
            console.error('Failed to fetch suppliers', e);
        }
    };

    // Simplified fallback if needed, but backend request now returns full objects
    const fetchVariants = async (variantIds: number[]) => {
        setIsLoadingVariants(true);
        try {
            // Variation details require a WooCommerce API call 
            // For now, we only have the IDs - full sync happens in WooCommerce
            const variants = variantIds.map(id => ({
                id,
                sku: '', // Not available without WooCommerce API call
                price: '', // Not available without WooCommerce API call
                attributes: []
            }));
            setVariants(variants);
        } finally {
            setIsLoadingVariants(false);
        }
    };

    const handleSave = async () => {
        if (!currentAccount || !id || !token) return;
        setIsSaving(true);
        try {
            // Save product data
            await ProductService.updateProduct(id, {
                name: formData.name,
                sku: formData.sku,
                binLocation: formData.binLocation,
                stockStatus: formData.stockStatus,
                isGoldPriceApplied: formData.isGoldPriceApplied,
                weight: formData.weight,
                length: formData.length,
                width: formData.width,
                height: formData.height,
                price: formData.price,
                salePrice: formData.salePrice,
                description: formData.description,
                short_description: formData.short_description,
                cogs: formData.cogs,
                miscCosts: formData.miscCosts,
                supplierId: formData.supplierId,
                images: formData.images,
                variations: variants, // Include variations in save
                focusKeyword: formData.focusKeyword
            }, token, currentAccount.id);

            // Also save BOM if the panel is mounted
            const bomSaveResult = await bomPanelRef.current?.save();
            if (bomSaveResult === false) {
                alert('Product saved, but BOM configuration failed to save.');
            }

            fetchProduct(); // Reload
        } catch (error) {
            console.error(error);
            alert('Failed to save changes');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSync = async () => {
        if (!currentAccount || !id || !token) return;
        setIsSyncing(true);
        try {
            const updated = await ProductService.syncProduct(id, token, currentAccount.id);
            Logger.debug('Product synced', { productId: id, wooId: updated?.wooId });
            await fetchProduct();
            alert('Product synced successfully from WooCommerce.');
        } catch (error: any) {
            console.error('Sync failed:', error);
            alert(`Sync failed: ${error.message}`);
        } finally {
            setIsSyncing(false);
        }
    };

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
                            onChange={(updates) => setFormData(prev => ({ ...prev, ...updates }))}
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
                                onChange={(imgs) => setFormData(prev => ({ ...prev, images: imgs }))}
                            />
                        </div>

                        {/* WooCommerce Info Panel */}
                        <WooCommerceInfoPanel
                            manageStock={product.manageStock ?? false}
                            categories={product.categories || []}
                            tags={product.tags || []}
                        />
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
                        formData={formData}
                        onChange={(updates) => setFormData(prev => ({ ...prev, ...updates }))}
                    />
                    <GoldPricePanel
                        product={{ ...product, isGoldPriceApplied: formData.isGoldPriceApplied }}
                        onChange={(updates) => setFormData(prev => ({ ...prev, ...updates }))}
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
                        weightUnit={currentAccount?.weightUnit}
                        dimensionUnit={currentAccount?.dimensionUnit}
                        onChange={(updates) => setFormData(prev => ({ ...prev, ...updates }))}
                    />
                    {/* BOM for Simple Products */}
                    {product.type !== 'variable' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
                            <BOMPanel ref={bomPanelRef} productId={product.id} variants={[]} fixedVariationId={0} />
                        </div>
                    )}
                </div>
            )
        },
        // Only show Variations tab for variable products with actual variations
        ...(product.type === 'variable' && product.variations?.length ? [{
            id: 'variants',
            label: 'Variations',
            icon: <Layers size={16} />,
            content: (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <VariationsPanel
                        product={product}
                        variants={variants}
                        onUpdate={(updated) => setVariants(updated)}
                    />
                </div>
            )
        }] : []),
        {
            id: 'seo',
            label: 'SEO & Discovery',
            icon: <Search size={16} />,
            content: (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="space-y-6">
                        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 p-6">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">SEO Health</h3>
                                <div className="flex gap-2">
                                    <SeoScoreBadge score={seoResult.score || 0} size="md" tests={seoResult.tests} />
                                </div>
                            </div>
                            <SeoAnalysisPanel
                                score={seoResult.score}
                                tests={seoResult.tests}
                                focusKeyword={formData.focusKeyword}
                            />
                            <div className="mt-6 pt-6 border-t border-gray-100/50">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Focus Keyword</label>
                                <input
                                    type="text"
                                    value={formData.focusKeyword}
                                    onChange={(e) => setFormData({ ...formData, focusKeyword: e.target.value })}
                                    className="w-full px-4 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="space-y-6">
                        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 p-6">
                            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4">Merchant Center Status</h3>
                            <MerchantCenterPanel
                                score={product.merchantCenterScore || 0}
                                issues={product.merchantCenterIssues || []}
                            />
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
                            <button
                                onClick={() => navigate('/inventory')}
                                className="p-2 hover:bg-gray-100/80 rounded-full text-gray-500 transition-colors"
                            >
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
                                    <span>•</span>
                                    <a
                                        href={product.permalink}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center gap-1 text-blue-600 hover:text-blue-800 transition-colors"
                                    >
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
        </div>
    );
}

