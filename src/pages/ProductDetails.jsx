import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useSettings } from '../context/SettingsContext';
import { updateProduct, fetchVariations, updateVariation, fetchWCSettings } from '../services/api';
import { toast, Toaster } from 'sonner';
import { ArrowLeft, ExternalLink, Edit2, Save, X } from 'lucide-react';
import './ProductDetails.css';

import { useAccount } from '../context/AccountContext';

// Import New Sub-Components
import ProductImageGallery from '../components/products/ProductImageGallery';
import ProductGeneralInfo from '../components/products/ProductGeneralInfo';
import ProductVariationList from '../components/products/ProductVariationList';
import ProductLinkedItems from '../components/products/ProductLinkedItems';
import ProductSidebar from '../components/products/ProductSidebar';

const ProductDetails = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { settings } = useSettings();
    const { activeAccount } = useAccount();
    const productId = parseInt(id);

    const product = useLiveQuery(async () => {
        if (!activeAccount) return null;
        return await db.products.get([activeAccount.id, productId]);
    }, [activeAccount, productId]);
    const suppliers = useLiveQuery(() => db.suppliers.toArray()) || [];
    const [activeImage, setActiveImage] = useState(0);
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState({});
    const [isSaving, setIsSaving] = useState(false);

    // Variations State
    const [variations, setVariations] = useState([]);
    const [loadingVariations, setLoadingVariations] = useState(false);

    // Variation Editing
    const [editingVariation, setEditingVariation] = useState(null);
    const [variationForm, setVariationForm] = useState({});
    const [savingVariation, setSavingVariation] = useState(false);

    // Store Units
    const [storeUnits, setStoreUnits] = useState({ weight: 'kg', dimension: 'cm' });

    // Linked Products (Recipe) State
    const linkedComponents = useLiveQuery(() =>
        activeAccount ? db.product_components.where({ parent_id: productId, account_id: activeAccount.id }).toArray() : []
        , [productId, activeAccount]) || [];

    const childIds = linkedComponents.map(c => c.child_id);

    const childProducts = useLiveQuery(async () => {
        if (!activeAccount || childIds.length === 0) return [];
        const keys = childIds.map(id => [activeAccount.id, id]);
        return (await db.products.bulkGet(keys)).filter(Boolean);
    }, [activeAccount, childIds]) || [];

    const [linkSearchTerm, setLinkSearchTerm] = useState('');
    const [linkSearchResults, setLinkSearchResults] = useState([]);

    // Search for products to link
    useEffect(() => {
        const search = async () => {
            if (linkSearchTerm.length < 2 || !activeAccount) {
                setLinkSearchResults([]);
                return;
            }
            const resultsSafe = await db.products
                .where('account_id').equals(activeAccount.id)
                .filter(p => p.name && p.name.toLowerCase().includes(linkSearchTerm.toLowerCase()) && p.id !== productId)
                .limit(10)
                .toArray();
            setLinkSearchResults(resultsSafe);
        };
        const timeout = setTimeout(search, 300);
        return () => clearTimeout(timeout);
    }, [linkSearchTerm, productId, activeAccount]);

    const handleAddLinkedProduct = async (childId) => {
        if (!activeAccount) return;
        try {
            // Check if already linked
            const existing = await db.product_components
                .where({ parent_id: productId, child_id: childId, account_id: activeAccount.id })
                .first();

            if (existing) {
                toast.error("Product already linked.");
                return;
            }

            await db.product_components.add({
                parent_id: productId,
                child_id: childId,
                quantity: 1,
                account_id: activeAccount.id
            });
            toast.success("Product linked to recipe");
            setLinkSearchTerm('');
            setLinkSearchResults([]);
        } catch (err) {
            console.error(err);
            toast.error("Failed to link product");
        }
    };

    const handleRemoveLinkedProduct = async (id) => {
        try {
            await db.product_components.delete(id);
            toast.success("Removed from recipe");
        } catch (err) {
            console.error(err);
            toast.error("Failed to remove product");
        }
    };

    const handleUpdateLinkQty = async (id, qty) => {
        try {
            await db.product_components.update(id, { quantity: parseFloat(qty) });
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => {
        const loadUnits = async () => {
            if (settings.storeUrl) {
                try {
                    // Try to get from local storage first to save API calls
                    const cached = localStorage.getItem('wc_store_units');
                    if (cached) {
                        setStoreUnits(JSON.parse(cached));
                    } else {
                        const [wUnit, dUnit] = await Promise.all([
                            fetchWCSettings(settings, 'products', 'woocommerce_weight_unit'),
                            fetchWCSettings(settings, 'products', 'woocommerce_dimension_unit')
                        ]);
                        const units = { weight: wUnit.value, dimension: dUnit.value };
                        setStoreUnits(units);
                        localStorage.setItem('wc_store_units', JSON.stringify(units));
                    }
                } catch (e) {
                    console.warn("Failed to fetch store units", e);
                }
            }
        };
        loadUnits();
    }, [settings]);

    useEffect(() => {
        if (product) {
            setEditForm({
                name: product.name,
                regular_price: product.regular_price,
                sale_price: product.sale_price,
                sku: product.sku,
                stock_status: product.stock_status,
                stock_quantity: product.stock_quantity,
                manage_stock: product.manage_stock,
                cost_price: product.cost_price || 0,
                // Dimensions & Weight
                weight: product.weight || '',
                dim_length: product.dimensions?.length || '',
                dim_width: product.dimensions?.width || '',
                dim_height: product.dimensions?.height || '',
                // Descriptions
                short_description: product.short_description || '',
                description: product.description || '',
                tax_status: product.tax_status || 'taxable',
                tax_class: product.tax_class || '',
                bin_location: product.bin_location || '',
                supplier_id: product.supplier_id || '',
                focus_keyword: product.meta_data?.find(m => m.key === '_seo_focus_keyword')?.value || '',
                // Gold Price Feature
                is_gold_priced: product.meta_data?.find(m => m.key === '_is_gold_priced')?.value === 'yes'
            });

            // Auto-detect keyword if missing from meta
            if (!product.meta_data?.find(m => m.key === '_seo_focus_keyword')?.value) {
                const potentialKw = product.name ? product.name.split(' ').slice(0, 3).join(' ') : '';
                setEditForm(prev => ({ ...prev, focus_keyword: potentialKw }));
            }

            // Fetch variations if variable product
            if (product.type === 'variable') {
                setLoadingVariations(true);
                fetchVariations(settings, product.id)
                    .then(data => setVariations(data))
                    .catch(err => console.error(err))
                    .finally(() => setLoadingVariations(false));
            }
        }
    }, [product, settings]);

    // Gold Price Calculation Effect
    useEffect(() => {
        if (isEditing && editForm.is_gold_priced && activeAccount?.features?.goldPrice) {
            const goldPrice = parseFloat(settings.goldPrice) || 0;
            const weight = parseFloat(editForm.weight) || 0;
            if (goldPrice > 0 && weight > 0) {
                const calculatedCost = (weight * goldPrice).toFixed(2);
                setEditForm(prev => {
                    if (prev.cost_price !== calculatedCost) {
                        return { ...prev, cost_price: calculatedCost };
                    }
                    return prev;
                });
            }
        }
    }, [isEditing, editForm.is_gold_priced, editForm.weight, settings.goldPrice, activeAccount?.features?.goldPrice]);

    if (!product) return <div className="p-8">Loading product...</div>;

    const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

    const images = product.images || [];

    const getStockStatus = (prod) => {
        if (prod.stock_status === 'outofstock') return { label: 'Out of Stock', class: 'stock-out-of-stock' };
        if (prod.stock_quantity !== null && prod.stock_quantity < 5) return { label: `Low Stock (${prod.stock_quantity})`, class: 'stock-low-stock' };
        return { label: `In Stock ${prod.stock_quantity !== null ? `(${prod.stock_quantity})` : ''}`, class: 'stock-in-stock' };
    };

    const stockInfo = getStockStatus(product);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const dataToSend = { ...editForm };
            delete dataToSend.cost_price; // Don't send this root field to WP

            dataToSend.meta_data = [
                { key: '_alg_wc_cog_cost', value: editForm.cost_price },
                { key: '_bin_location', value: editForm.bin_location },
                { key: '_supplier_id', value: editForm.supplier_id },
                { key: '_seo_focus_keyword', value: editForm.focus_keyword },
                { key: '_is_gold_priced', value: editForm.is_gold_priced ? 'yes' : 'no' }
            ];

            dataToSend.dimensions = {
                length: editForm.dim_length,
                width: editForm.dim_width,
                height: editForm.dim_height
            };
            delete dataToSend.dim_length;
            delete dataToSend.dim_width;
            delete dataToSend.dim_height;
            delete dataToSend.is_gold_priced;

            const updatedData = await updateProduct(settings, productId, dataToSend);

            const costMeta = updatedData.meta_data?.find(m => m.key === '_alg_wc_cog_cost');
            const binMeta = updatedData.meta_data?.find(m => m.key === '_bin_location');
            const supplyMeta = updatedData.meta_data?.find(m => m.key === '_supplier_id');
            const flatProduct = {
                ...updatedData,
                account_id: activeAccount.id,
                cost_price: costMeta ? parseFloat(costMeta.value) : 0,
                bin_location: binMeta ? binMeta.value : '',
                supplier_id: supplyMeta ? parseInt(supplyMeta.value) : null,
                meta_data: updatedData.meta_data
            };

            await db.products.put(flatProduct);
            toast.success('Product updated successfully!');
            setIsEditing(false);
        } catch (error) {
            console.error(error);
            toast.error('Failed to update product');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveVariation = async (variationId) => {
        setSavingVariation(true);
        try {
            const payload = { ...variationForm, meta_data: [{ key: '_bin_location', value: variationForm.bin_location }] };
            const updatedVar = await updateVariation(settings, productId, variationId, payload);

            setVariations(prev => prev.map(v => v.id === variationId ? updatedVar : v));

            if (activeAccount) {
                await db.products.put({
                    id: updatedVar.id,
                    account_id: activeAccount.id,
                    name: updatedVar.name || `${product.name} - Var ${updatedVar.id}`,
                    sku: updatedVar.sku,
                    bin_location: variationForm.bin_location,
                    stock_quantity: updatedVar.stock_quantity,
                    stock_status: updatedVar.stock_status,
                    type: 'variation',
                    date_created: updatedVar.date_created,
                    parent_id: productId
                });
            }

            toast.success('Variation updated');
            setEditingVariation(null);
        } catch (error) {
            console.error(error);
            toast.error('Failed to update variation');
        } finally {
            setSavingVariation(false);
        }
    };

    return (
        <div className="product-details-page">
            <Toaster position="top-right" theme="dark" />

            {/* Top Action Header */}
            <div className="mb-6 glass-panel-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button onClick={() => navigate('/products')} className="btn" style={{ background: 'transparent', paddingLeft: 0, color: 'var(--text-muted)' }}>
                        <ArrowLeft size={18} /> Back
                    </button>
                    {!isEditing && <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{product.name}</h2>}
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                    {!isEditing ? (
                        <>
                            <a href={product.permalink} target="_blank" rel="noopener noreferrer" className="btn" style={{ background: 'rgba(255,255,255,0.05)', fontSize: '0.9rem' }}>
                                View <ExternalLink size={14} style={{ marginLeft: '6px' }} />
                            </a>
                            <button onClick={() => setIsEditing(true)} className="btn btn-primary" style={{ fontSize: '0.9rem' }}>
                                Edit Product <Edit2 size={14} style={{ marginLeft: '6px' }} />
                            </button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => setIsEditing(false)} className="btn" style={{ background: 'rgba(255,255,255,0.05)', fontSize: '0.9rem' }}>
                                Cancel <X size={14} style={{ marginLeft: '6px' }} />
                            </button>
                            <button onClick={handleSave} disabled={isSaving} className="btn btn-primary" style={{ fontSize: '0.9rem' }}>
                                {isSaving ? 'Saving...' : 'Save Changes'} <Save size={14} style={{ marginLeft: '6px' }} />
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="product-layout-grid">

                {/* 1. Gallery Column (Left) */}
                <div className="product-gallery-col">
                    <ProductImageGallery
                        images={images}
                        activeImage={activeImage}
                        setActiveImage={setActiveImage}
                    />
                </div>

                {/* 2. Main Content Column (Center) */}
                <div className="product-main-col">

                    <ProductGeneralInfo
                        isEditing={isEditing}
                        product={product}
                        editForm={editForm}
                        setEditForm={setEditForm}
                        formatCurrency={formatCurrency}
                        settings={settings}
                        activeAccount={activeAccount}
                        storeUnits={storeUnits}
                    />

                    {/* Variations */}
                    {product.type === 'variable' && (
                        <ProductVariationList
                            variations={variations}
                            loading={loadingVariations}
                            editingVariation={editingVariation}
                            setEditingVariation={(val) => {
                                setEditingVariation(val?.id || null);
                                if (val) {
                                    const binMeta = val.meta_data?.find(m => m.key === '_bin_location');
                                    setVariationForm({
                                        regular_price: val.regular_price,
                                        sale_price: val.sale_price,
                                        stock_status: val.stock_status,
                                        stock_quantity: val.stock_quantity,
                                        sku: val.sku,
                                        bin_location: binMeta ? binMeta.value : ''
                                    });
                                }
                            }}
                            variationForm={variationForm}
                            setVariationForm={setVariationForm}
                            handleSaveVariation={handleSaveVariation}
                            savingVariation={savingVariation}
                            formatCurrency={formatCurrency}
                        />
                    )}

                    {/* Linked Products (Recipe) */}
                    <ProductLinkedItems
                        linkedComponents={linkedComponents}
                        childProducts={childProducts}
                        linkSearchTerm={linkSearchTerm}
                        setLinkSearchTerm={setLinkSearchTerm}
                        linkSearchResults={linkSearchResults}
                        handleAddLinkedProduct={handleAddLinkedProduct}
                        handleRemoveLinkedProduct={handleRemoveLinkedProduct}
                        handleUpdateLinkQty={handleUpdateLinkQty}
                        activeAccount={activeAccount}
                    />

                </div>

                {/* 3. Sidebar Column (Right) */}
                <ProductSidebar
                    isEditing={isEditing}
                    product={product}
                    editForm={editForm}
                    setEditForm={setEditForm}
                    stockInfo={stockInfo}
                    suppliers={suppliers}
                    storeUnits={storeUnits}
                    images={images}
                />

            </div>
        </div>
    );
};

export default ProductDetails;
