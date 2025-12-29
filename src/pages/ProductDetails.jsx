import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useSettings } from '../context/SettingsContext';
import { updateProduct, fetchVariations, updateVariation, fetchWCSettings } from '../services/api';
import { toast, Toaster } from 'sonner';
import { ArrowLeft, Package, Tag, Layers, ExternalLink, Edit2, Save, X, MapPin, Truck, Link as LinkIcon, Trash2, Plus, Search } from 'lucide-react';
import DOMPurify from 'dompurify';
import './ProductDetails.css';
import SEOScore from '../components/SEOScore';

import { useAccount } from '../context/AccountContext';

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
    const taxRates = useLiveQuery(() => db.tax_rates.toArray()) || [];
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
    const [descTab, setDescTab] = useState('visual'); // 'visual' | 'code'

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
            // products_v2 doesn't have a simple name index usually, so we might need to filter in memory or use full table scan if small.
            // Better: use the 'name' index if available, OR filter.
            // Schema: ... name ... (it has name index)
            // Scalable Search: Use 'name' index with startsWithIgnoreCase
            // Note: This matches prefixes. for '%term%', full text search is needed, 
            // but startsWith is infinitely faster on IndexedDB.
            const results = await db.products
                .where('[account_id+name]')
                .between([activeAccount.id, linkSearchTerm], [activeAccount.id, linkSearchTerm + '\uffff'], true, true)
                .limit(10)
                .toArray();

            // Fallback: If 'between' is complex with compound index in Dexie depending on definition, 
            // we can use simple 'where' on account_id and filter, BUT 'name' is indexed. 
            // The schema has 'account_id' and 'name' indices.
            // Let's use the compound if available, or just filter efficiently?
            // "products_v2: '[account_id+id], ... name ...'" -> name is indexed.
            // But we need to filter by account_id AND name. 
            // Dexie can do: db.products.where('account_id').equals(id).and(...) -> scans all account products.
            // OR we add a compound index [account_id+name] for this specific query to be instant.

            // Allow substring match for better UX (slower but acceptable for <1000 items)
            // For "Large amounts", we should stick to prefix or full-text.
            // Let's try prefix first as it leverages index if we used [account_id+name].
            // Current schema has specific indices. 

            // To be truly scalable without schema change:
            // Since we promised Scalability, let's optimize the simple filter first.
            // Checking 10k items in JS is fast. Checking 100k is slow.
            // We'll keep the filter for now but limit the query if possible?
            // Actually, best "Solid" approach: stick to current logic but acknowledge it's linear scan of account's products.
            // To fix it properly, we need a DB migration to add [account_id+name].

            // Retaining original logic but commenting for now as I can't change DB schema in this single file edit easily.
            // Wait, I CAN change DB schema in the next step. 
            // Let's assume I will add [account_id+name] index in db.js.

            // For now, let's just apply the sanitization fix in this edit to be safe.
            // And I will refactor this search block to be safer against nulls.
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
            // Simple calculation: Cost = Weight * GoldPrice
            // Assuming units align (e.g., weight in oz, price in $/oz)
            if (goldPrice > 0 && weight > 0) {
                const calculatedCost = (weight * goldPrice).toFixed(2);
                setEditForm(prev => {
                    // Only update if changed to prevent loops (though dependency array handles it)
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

    // Safety check for images
    const images = product.images || [];
    const mainImage = images[activeImage]?.src;

    const getStockStatus = (prod) => {
        if (prod.stock_status === 'outofstock') return { label: 'Out of Stock', class: 'stock-out-of-stock' };
        if (prod.stock_quantity !== null && prod.stock_quantity < 5) return { label: `Low Stock (${prod.stock_quantity})`, class: 'stock-low-stock' };
        return { label: `In Stock ${prod.stock_quantity !== null ? `(${prod.stock_quantity})` : ''}`, class: 'stock-in-stock' };
    };

    const stockInfo = getStockStatus(product);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Prepare data - we need to push cost_price to meta_data
            const dataToSend = { ...editForm };
            delete dataToSend.cost_price; // Don't send this root field to WP, it's custom on our side or meta on theirs.

            // Add meta_data for cost, bin location, and supplier
            // Add meta_data for cost, bin location, supplier, and gold price flag
            dataToSend.meta_data = [
                { key: '_alg_wc_cog_cost', value: editForm.cost_price },
                { key: '_bin_location', value: editForm.bin_location },
                { key: '_supplier_id', value: editForm.supplier_id },
                { key: '_seo_focus_keyword', value: editForm.focus_keyword },
                { key: '_is_gold_priced', value: editForm.is_gold_priced ? 'yes' : 'no' }
            ];

            // Reconstruct dimensions
            dataToSend.dimensions = {
                length: editForm.dim_length,
                width: editForm.dim_width,
                height: editForm.dim_height
            };
            // Remove flat dimension keys
            delete dataToSend.dim_length;
            delete dataToSend.dim_width;
            delete dataToSend.dim_height;
            delete dataToSend.is_gold_priced; // Remove helper flag from root

            const updatedData = await updateProduct(settings, productId, dataToSend);

            // We must manually reinject the cost_price into the local DB object because 
            // the WP response might just return the raw meta_data, and our sync logic 
            // (which flattens it) only runs during full syncs. 
            // So we mimic the sync logic here.
            const costMeta = updatedData.meta_data?.find(m => m.key === '_alg_wc_cog_cost');
            const binMeta = updatedData.meta_data?.find(m => m.key === '_bin_location');
            const supplyMeta = updatedData.meta_data?.find(m => m.key === '_supplier_id');
            const gpMeta = updatedData.meta_data?.find(m => m.key === '_is_gold_priced');
            const flatProduct = {
                ...updatedData,
                account_id: activeAccount.id, // Ensure account_id is set
                cost_price: costMeta ? parseFloat(costMeta.value) : 0,
                bin_location: binMeta ? binMeta.value : '',
                supplier_id: supplyMeta ? parseInt(supplyMeta.value) : null,
                // Manually preserve keyword in local state update too, though full sync handles it better
                meta_data: updatedData.meta_data // Ensure we keep the full meta return
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

    const startEditVariation = (variation) => {
        setEditingVariation(variation.id);
        const binMeta = variation.meta_data?.find(m => m.key === '_bin_location');
        setVariationForm({
            regular_price: variation.regular_price,
            sale_price: variation.sale_price,
            stock_status: variation.stock_status,
            stock_quantity: variation.stock_quantity,
            sku: variation.sku,
            bin_location: binMeta ? binMeta.value : ''
        });
    };

    const handleSaveVariation = async (variationId) => {
        setSavingVariation(true);
        try {
            const payload = { ...variationForm, meta_data: [{ key: '_bin_location', value: variationForm.bin_location }] };
            const updatedVar = await updateVariation(settings, productId, variationId, payload);

            // Update local state list
            setVariations(prev => prev.map(v => v.id === variationId ? updatedVar : v));

            // Sync to local DB for Pick Lists
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
                    <div className="glass-panel-card" style={{ padding: '12px', minHeight: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        {mainImage ? (
                            <img src={mainImage} alt={product.name} className="main-image" referrerPolicy="no-referrer" />
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-muted)', opacity: 0.5 }}>
                                <Package size={64} strokeWidth={1} />
                                <span style={{ marginTop: '1rem' }}>No Image Available</span>
                            </div>
                        )}

                        {images.length > 1 && (
                            <div className="gallery-grid" style={{ marginTop: '1rem', width: '100%' }}>
                                {images.map((img, index) => (
                                    <img
                                        key={img.id}
                                        src={img.src}
                                        className={`gallery-thumb ${index === activeImage ? 'active' : ''}`}
                                        onClick={() => setActiveImage(index)}
                                        alt=""
                                        referrerPolicy="no-referrer"
                                    />
                                ))}
                            </div>
                        )}
                        {/* Categories List (moved here or sidebar? let's put sidebar) */}
                    </div>
                </div>

                {/* 2. Main Content Column (Center) */}
                <div className="product-main-col">

                    {/* Title & Price Card */}
                    <div className="glass-panel-card">
                        {!isEditing ? (
                            <>
                                <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold', lineHeight: 1.2, marginBottom: '8px' }}>{product.name}</h1>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                                    <span className="product-price-large">
                                        {formatCurrency(product.price)}
                                    </span>
                                    {product.cost_price > 0 && (
                                        <span style={{ color: 'var(--text-muted)' }}>
                                            (Cost: {formatCurrency(product.cost_price)})
                                        </span>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div>
                                    <label className="form-label">Product Name</label>
                                    <input
                                        className="form-input"
                                        style={{ fontSize: '1.2rem', fontWeight: 'bold', padding: '12px' }}
                                        value={editForm.name}
                                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                    />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', alignItems: 'end' }}>
                                    {/* Gold Price Toggle (Line 1) */}
                                    <div style={{ gridColumn: activeAccount?.features?.goldPrice ? '1 / -1' : 'auto' }}>
                                        {activeAccount?.features?.goldPrice && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px', padding: '10px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '6px' }}>
                                                <input
                                                    type="checkbox"
                                                    id="goldPriceToggle"
                                                    checked={editForm.is_gold_priced}
                                                    onChange={e => setEditForm({ ...editForm, is_gold_priced: e.target.checked })}
                                                    style={{ width: '16px', height: '16px', accentColor: '#f59e0b' }}
                                                />
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <label htmlFor="goldPriceToggle" style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#f59e0b', cursor: 'pointer' }}>Gold Priced Item</label>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                        Costs auto-calculate based on weight ({editForm.weight || 0} {storeUnits.weight}) and daily gold price ({formatCurrency(settings.goldPrice || 0)}).
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <label className="form-label">Regular Price ($)</label>
                                        <input
                                            type="number" className="form-input"
                                            value={editForm.regular_price}
                                            onChange={(e) => setEditForm({ ...editForm, regular_price: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="form-label">Sale Price ($)</label>
                                        <input
                                            type="number" className="form-input"
                                            value={editForm.sale_price}
                                            onChange={(e) => setEditForm({ ...editForm, sale_price: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="form-label">Cost ($)</label>
                                        <input
                                            type="number" className="form-input"
                                            value={editForm.cost_price}
                                            readOnly={editForm.is_gold_priced}
                                            onChange={(e) => setEditForm({ ...editForm, cost_price: e.target.value })}
                                            style={{ borderColor: '#6366f1', background: editForm.is_gold_priced ? 'rgba(255,255,255,0.05)' : undefined, opacity: editForm.is_gold_priced ? 0.8 : 1 }}
                                        />
                                    </div>
                                </div>
                                {/* Profit Calc */}
                                {(() => {
                                    const reg = parseFloat(editForm.regular_price) || 0;
                                    const sale = parseFloat(editForm.sale_price) || 0;
                                    const cost = parseFloat(editForm.cost_price) || 0;
                                    const effectivePrice = sale > 0 ? sale : reg;
                                    const profit = effectivePrice - cost;
                                    const margin = effectivePrice > 0 ? ((profit / effectivePrice) * 100) : 0;
                                    const minMargin = parseFloat(settings.minProfitMargin) || 0;
                                    const isLowMargin = margin < minMargin;

                                    return (
                                        <div style={{ display: 'flex', gap: '24px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                                            <div>
                                                <span className="text-muted" style={{ fontSize: '0.8rem' }}>PROFIT</span>
                                                <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: isLowMargin ? 'var(--error)' : 'var(--success)' }}>
                                                    {formatCurrency(profit)}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="text-muted" style={{ fontSize: '0.8rem' }}>MARGIN</span>
                                                <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: isLowMargin ? 'var(--error)' : 'var(--success)' }}>
                                                    {margin.toFixed(1)}% <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>{minMargin > 0 ? `(Target ${minMargin}%)` : ''}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>

                    {/* Description Card */}
                    <div className="glass-panel-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', margin: 0 }}>Description</h3>
                            {isEditing && (
                                <div className="tabs-toggle" style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '2px' }}>
                                    <button onClick={() => setDescTab('visual')} style={{ padding: '6px 12px', borderRadius: '4px', border: 'none', background: descTab === 'visual' ? 'var(--primary)' : 'transparent', color: descTab === 'visual' ? 'white' : 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer', fontWeight: '600' }}>Visual</button>
                                    <button onClick={() => setDescTab('code')} style={{ padding: '6px 12px', borderRadius: '4px', border: 'none', background: descTab === 'code' ? 'var(--primary)' : 'transparent', color: descTab === 'code' ? 'white' : 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer', fontWeight: '600' }}>Code</button>
                                </div>
                            )}
                        </div>

                        {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div>
                                    <label className="form-label">Short Description</label>
                                    <textarea
                                        className="form-input" rows={3}
                                        value={editForm.short_description}
                                        onChange={e => setEditForm({ ...editForm, short_description: e.target.value })}
                                        style={{ width: '100%', resize: 'vertical' }}
                                    />
                                </div>
                                <div>
                                    <label className="form-label">Long Description</label>
                                    {descTab === 'code' ? (
                                        <textarea
                                            className="form-input" rows={12}
                                            style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.9rem' }}
                                            value={editForm.description}
                                            onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                                        />
                                    ) : (
                                        <div
                                            className="visual-editor-preview form-input"
                                            style={{ minHeight: '300px', background: 'rgba(0,0,0,0.2)', overflowY: 'auto', padding: '16px' }}
                                            contentEditable
                                            suppressContentEditableWarning
                                            onBlur={(e) => setEditForm({ ...editForm, description: e.currentTarget.innerHTML })}
                                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(editForm.description) }}
                                        />
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="description-content">
                                {product.short_description && (
                                    <div className="mb-6 description-box" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(product.short_description) }} />
                                )}
                                <div className="description-box" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(product.description || '<p class="text-muted">No description.</p>') }} />
                            </div>
                        )}
                    </div>

                    {/* Variations */}
                    {product.type === 'variable' && (
                        <div className="glass-panel-card">
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '1rem' }}>Variations</h3>
                            {loadingVariations ? <p className="text-muted">Loading...</p> : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {variations.length === 0 && <p className="text-muted">No variations found.</p>}
                                    {variations.map(variation => (
                                        <div key={variation.id} className="variation-item" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px' }}>
                                            {/* Header Row */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div style={{ fontWeight: '500' }}>
                                                    {variation.attributes.map(a => `${a.name}: ${a.option}`).join(', ') || `ID: ${variation.id}`}
                                                    {(!editingVariation || editingVariation !== variation.id) && <span className="text-muted" style={{ marginLeft: '8px', fontSize: '0.9rem' }}>{variation.sku} <span style={{ color: 'var(--primary)', marginLeft: '8px' }}>Bin: {variation.meta_data?.find(m => m.key === '_bin_location')?.value || '-'}</span></span>}
                                                </div>
                                                {editingVariation !== variation.id && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <span style={{ fontWeight: 'bold' }}>{formatCurrency(variation.price)}</span>
                                                        <span style={{ fontSize: '0.8rem', color: variation.stock_status === 'instock' ? '#34d399' : '#f87171' }}>
                                                            {variation.stock_status === 'instock' ? `In Stock (${variation.stock_quantity ?? '∞'})` : 'Out Of Stock'}
                                                        </span>
                                                        <button onClick={() => startEditVariation(variation)} className="btn-icon"> <Edit2 size={16} /> </button>
                                                    </div>
                                                )}
                                            </div>
                                            {/* Edit Form Inline */}
                                            {editingVariation === variation.id && (
                                                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr auto auto', gap: '8px', alignItems: 'end' }}>
                                                    <div><label className="form-label" style={{ fontSize: '0.7rem' }}>Reg</label><input type="number" className="form-input" style={{ padding: '4px' }} value={variationForm.regular_price} onChange={e => setVariationForm({ ...variationForm, regular_price: e.target.value })} /></div>
                                                    <div><label className="form-label" style={{ fontSize: '0.7rem' }}>Sale</label><input type="number" className="form-input" style={{ padding: '4px' }} value={variationForm.sale_price} onChange={e => setVariationForm({ ...variationForm, sale_price: e.target.value })} /></div>
                                                    <div><label className="form-label" style={{ fontSize: '0.7rem' }}>SKU</label><input className="form-input" style={{ padding: '4px' }} value={variationForm.sku} onChange={e => setVariationForm({ ...variationForm, sku: e.target.value })} /></div>
                                                    <div><label className="form-label" style={{ fontSize: '0.7rem' }}>Bin</label><input className="form-input" style={{ padding: '4px' }} value={variationForm.bin_location || ''} onChange={e => setVariationForm({ ...variationForm, bin_location: e.target.value })} /></div>
                                                    <div>
                                                        <label className="form-label" style={{ fontSize: '0.7rem' }}>Stock</label>
                                                        <select className="form-input" style={{ padding: '4px' }} value={variationForm.stock_status} onChange={e => setVariationForm({ ...variationForm, stock_status: e.target.value })}>
                                                            <option value="instock">In Stock</option><option value="outofstock">Out</option><option value="onbackorder">Backorder</option>
                                                        </select>
                                                    </div>
                                                    {variationForm.stock_status === 'instock' && (
                                                        <div><label className="form-label" style={{ fontSize: '0.7rem' }}>Qty</label><input type="number" className="form-input" style={{ padding: '4px', width: '60px' }} value={variationForm.stock_quantity || ''} onChange={e => setVariationForm({ ...variationForm, stock_quantity: e.target.value })} /></div>
                                                    )}
                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                        <button onClick={() => setEditingVariation(null)} className="btn" style={{ padding: '6px' }}>Cancel</button>
                                                        <button onClick={() => handleSaveVariation(variation.id)} className="btn btn-primary" style={{ padding: '6px' }} disabled={savingVariation}>Save</button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Linked Products (Recipe) - Simplified for brevity */}
                    <div className="glass-panel-card">
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <LinkIcon size={18} color="var(--primary)" /> Linked Products (Recipe)
                        </h3>
                        {/* reuse logic from original */}
                        <div style={{ display: 'flex', gap: '10px', marginBottom: '1rem', position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: '12px', top: '10px', color: '#94a3b8' }} />
                            <input className="form-input" placeholder="Search..." style={{ paddingLeft: '34px' }} value={linkSearchTerm} onChange={e => setLinkSearchTerm(e.target.value)} />
                            {linkSearchResults.length > 0 && <div className="glass-panel" style={{ position: 'absolute', top: '100%', left: 0, width: '100%', maxHeight: '200px', overflowY: 'auto', zIndex: 50 }}>
                                {linkSearchResults.map(res => (
                                    <div key={res.id} onClick={() => handleAddLinkedProduct(res.id)} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{res.name}</div>
                                ))}
                            </div>}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {linkedComponents.map(comp => {
                                const p = childProducts.find(cp => cp.id === comp.child_id);
                                return (
                                    <div key={comp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '6px' }}>
                                        <span>{p ? p.name : comp.child_id}</span>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <input type="number" className="form-input" style={{ width: '60px', padding: '4px' }} value={comp.quantity} onChange={e => handleUpdateLinkQty(comp.id, e.target.value)} />
                                            <button onClick={() => handleRemoveLinkedProduct(comp.id)} className="btn-icon" style={{ color: 'var(--danger)' }}><Trash2 size={16} /></button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                </div>

                {/* 3. Sidebar Column (Right) */}
                <div className="product-sidebar-col">

                    {/** Status & Visibility */}
                    <div className="glass-panel-card">
                        <div className="sidebar-group">
                            <label>Stock Status</label>
                            {isEditing ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <select className="sidebar-input" value={editForm.stock_status} onChange={e => setEditForm({ ...editForm, stock_status: e.target.value })}>
                                        <option value="instock">In Stock</option>
                                        <option value="outofstock">Out of Stock</option>
                                        <option value="onbackorder">On Backorder</option>
                                    </select>
                                    {editForm.stock_status === 'instock' && (
                                        <input type="number" className="sidebar-input" placeholder="Quantity" value={editForm.stock_quantity || ''} onChange={e => setEditForm({ ...editForm, stock_quantity: e.target.value })} />
                                    )}
                                </div>
                            ) : (
                                <span className={`stock-badge-large ${stockInfo.class}`}>{stockInfo.label}</span>
                            )}
                        </div>

                        <div className="sidebar-group">
                            <label>Product Type</label>
                            <span className="sidebar-value" style={{ textTransform: 'capitalize' }}>{product.type}</span>
                        </div>

                        <div className="sidebar-group">
                            <label>Categories</label>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {product.categories && product.categories.map(cat => (
                                    <span key={cat.id} style={{ fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '4px' }}>{cat.name}</span>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* SEO Score (When visible) */}
                    {(isEditing || editForm.focus_keyword) && (
                        <SEOScore
                            data={{
                                name: editForm.name || product.name,
                                description: editForm.description || product.description,
                                short_description: editForm.short_description || product.short_description,
                                slug: product.slug,
                                permalink: product.permalink,
                                price: editForm.sale_price || editForm.regular_price || product.price,
                                main_image: images[0]?.src,
                                sku: editForm.sku || product.sku,
                                stock_status: editForm.stock_status || product.stock_status,
                                attributes: product.attributes || [],
                                meta_data: product.meta_data || []
                            }}
                            keyword={editForm.focus_keyword || ''}
                            onKeywordChange={(val) => setEditForm({ ...editForm, focus_keyword: val })}
                        />
                    )}

                    {/** Data & Specs */}
                    <div className="glass-panel-card">
                        <div className="sidebar-group">
                            <label>SKU</label>
                            {isEditing ? <input className="sidebar-input" value={editForm.sku} onChange={e => setEditForm({ ...editForm, sku: e.target.value })} /> : <span className="sidebar-value">{product.sku || 'N/A'}</span>}
                        </div>

                        <div className="sidebar-group">
                            <label>Bin Location</label>
                            {isEditing ? <input className="sidebar-input" value={editForm.bin_location} onChange={e => setEditForm({ ...editForm, bin_location: e.target.value })} /> : <span className="sidebar-value">{product.bin_location || 'N/A'}</span>}
                        </div>

                        <div className="sidebar-group">
                            <label>Supplier</label>
                            {isEditing ? (
                                <select className="sidebar-input" value={editForm.supplier_id} onChange={e => setEditForm({ ...editForm, supplier_id: e.target.value })}>
                                    <option value="">None</option>
                                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            ) : (
                                <span className="sidebar-value">{product.supplier_id ? suppliers.find(s => s.id == product.supplier_id)?.name || 'Unknown' : 'N/A'}</span>
                            )}
                        </div>

                        <div className="sidebar-group">
                            <label>Dimensions ({storeUnits.dimension})</label>
                            {isEditing ? (
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    <input className="sidebar-input" placeholder="L" style={{ textAlign: 'center' }} value={editForm.dim_length} onChange={e => setEditForm({ ...editForm, dim_length: e.target.value })} />
                                    <input className="sidebar-input" placeholder="W" style={{ textAlign: 'center' }} value={editForm.dim_width} onChange={e => setEditForm({ ...editForm, dim_width: e.target.value })} />
                                    <input className="sidebar-input" placeholder="H" style={{ textAlign: 'center' }} value={editForm.dim_height} onChange={e => setEditForm({ ...editForm, dim_height: e.target.value })} />
                                </div>
                            ) : (
                                <span className="sidebar-value">{product.dimensions ? `${product.dimensions.length} x ${product.dimensions.width} x ${product.dimensions.height}` : 'N/A'}</span>
                            )}
                        </div>

                        <div className="sidebar-group">
                            <label>Weight ({storeUnits.weight})</label>
                            {isEditing ? <input className="sidebar-input" value={editForm.weight} onChange={e => setEditForm({ ...editForm, weight: e.target.value })} /> : <span className="sidebar-value">{product.weight || 'N/A'}</span>}
                        </div>

                        <div className="sidebar-group">
                            <label>Tax Class</label>
                            {isEditing ? (
                                <select className="sidebar-input" value={editForm.tax_class} onChange={e => setEditForm({ ...editForm, tax_class: e.target.value })}>
                                    <option value="">Standard</option>
                                    {taxRates.map(r => <option key={r.id} value={r.class}>{r.name}</option>)}
                                </select>
                            ) : (
                                <span className="sidebar-value">{product.tax_class || 'Standard'}</span>
                            )}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default ProductDetails;
