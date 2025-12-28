import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSettings } from '../context/SettingsContext';
import { createProduct } from '../services/api';
import { db } from '../db/db';
import { toast } from 'sonner';
import { Save, Loader, X, Search, Plus, Trash2, Package } from 'lucide-react';

const CreateProduct = ({ onClose }) => { // Changed to accept onClose prop
    const { settings } = useSettings();
    const taxRates = useLiveQuery(() => db.tax_rates.toArray()) || [];
    const suppliers = useLiveQuery(() => db.suppliers.toArray()) || [];
    // Need products for the recipe search
    const allProducts = useLiveQuery(() => db.products.toArray()) || [];

    const [isSaving, setIsSaving] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        type: 'simple', // simple, variable, grouped, external, bundle
        regular_price: '',
        sale_price: '',
        description: '',
        short_description: '',
        sku: '',
        stock_status: 'instock',
        manage_stock: false,
        stock_quantity: '',
        tax_status: 'taxable',
        tax_class: '',
        bin_location: '',
        cost_price: '',
        supplier_id: '',
    });

    // Recipe State
    const [recipeComponents, setRecipeComponents] = useState([]); // { child_id, quantity, name, sku }
    const [recipeSearch, setRecipeSearch] = useState('');
    const [searchResult, setSearchResult] = useState([]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    // Recipe Handlers
    const handleSearchRecipe = (term) => {
        setRecipeSearch(term);
        if (term.length < 2) {
            setSearchResult([]);
            return;
        }
        const hits = allProducts
            .filter(p => (
                p.name.toLowerCase().includes(term.toLowerCase()) ||
                (p.sku && p.sku.toLowerCase().includes(term.toLowerCase()))
            ))
            .slice(0, 5);
        setSearchResult(hits);
    };

    const addComponent = (product) => {
        if (recipeComponents.some(c => c.child_id === product.id)) {
            toast.error('Product already in recipe');
            return;
        }
        setRecipeComponents([...recipeComponents, {
            child_id: product.id,
            quantity: 1,
            name: product.name,
            sku: product.sku,
            stock: product.stock_quantity
        }]);
        setRecipeSearch('');
        setSearchResult([]);
    };

    const updateComponentQty = (id, qty) => {
        setRecipeComponents(prev => prev.map(c => c.child_id === id ? { ...c, quantity: parseFloat(qty) } : c));
    };

    const removeComponent = (id) => {
        setRecipeComponents(prev => prev.filter(c => c.child_id !== id));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);

        try {
            // Prepare data for API
            // Map 'bundle' back to 'simple' for WC compatibility if needed, or keep as is if custom type supported
            // Typically bundles are Simple products with metadata or Grouped
            const apiType = formData.type === 'bundle' ? 'simple' : formData.type;

            const productData = {
                ...formData,
                type: apiType,
                manage_stock: formData.manage_stock,
                // Only send quantity if managing stock
                stock_quantity: formData.manage_stock ? parseInt(formData.stock_quantity) || 0 : null,
                meta_data: [
                    { key: '_bin_location', value: formData.bin_location },
                    { key: '_alg_wc_cog_cost', value: formData.cost_price },
                    { key: '_supplier_id', value: formData.supplier_id },
                    // If it's a bundle, maybe tag it?
                    ...(formData.type === 'bundle' ? [{ key: '_is_custom_bundle', value: 'yes' }] : [])
                ]
            };

            const newProduct = await createProduct(settings, productData);

            // Save to local DB
            await db.products.add({
                ...newProduct,
                // Ensure we override the type locally if we want to distinguish it
                // type: formData.type, // Maybe keep valid WC type locally too to avoid sync confusion
                bin_location: formData.bin_location,
                cost_price: parseFloat(formData.cost_price) || 0,
                supplier_id: parseInt(formData.supplier_id) || null
            });

            // If Bundle or any product with components, save components
            if (recipeComponents.length > 0) {
                const componentsToSave = recipeComponents.map(c => ({
                    parent_id: newProduct.id,
                    child_id: c.child_id,
                    quantity: c.quantity
                }));
                await db.product_components.bulkAdd(componentsToSave);
            }

            toast.success('Product created successfully!');
            onClose(); // Close modal

        } catch (error) {
            console.error("Failed to create product:", error);
            const msg = error.response?.data?.message || error.message || 'Failed to create product';
            toast.error(msg);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ width: '100%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto', margin: '1rem' }}>
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div>
                        <h2 className="modal-title">Create New Product</h2>
                        <p className="modal-desc">Add a new item to your inventory.</p>
                    </div>
                    <button onClick={onClose} className="btn-icon">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    {/* Basic Info */}
                    <div className="mobile-stack" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label className="input-label">Product Name *</label>
                        <input
                            required
                            name="name"
                            className="form-input"
                            placeholder="e.g. Premium T-Shirt"
                            value={formData.name}
                            onChange={handleChange}
                        />
                    </div>

                    <div className="mobile-stack-row" style={{ display: 'flex', gap: '1rem' }}>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label className="input-label">Product Type</label>
                            <select
                                name="type"
                                className="form-input"
                                value={formData.type}
                                onChange={handleChange}
                            >
                                <option value="simple">Simple Product</option>
                                <option value="variable">Variable Product</option>
                                <option value="bundle">Product Bundle (Recipe)</option>
                                <option value="grouped">Grouped Product</option>
                                <option value="external">External / Affiliate</option>
                            </select>
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label className="input-label">SKU</label>
                            <input
                                name="sku"
                                className="form-input"
                                placeholder="Unique ID"
                                value={formData.sku}
                                onChange={handleChange}
                            />
                        </div>
                    </div>

                    {/* Pricing */}
                    <div className="mobile-stack-row" style={{ display: 'flex', gap: '1rem' }}>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label className="input-label">Regular Price ($)</label>
                            <input
                                type="number"
                                name="regular_price"
                                className="form-input"
                                placeholder="0.00"
                                value={formData.regular_price}
                                onChange={handleChange}
                            />
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label className="input-label">Sale Price ($)</label>
                            <input
                                type="number"
                                name="sale_price"
                                className="form-input"
                                placeholder="0.00"
                                value={formData.sale_price}
                                onChange={handleChange}
                            />
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label className="input-label">Cost Price ($)</label>
                            <input
                                type="number"
                                name="cost_price"
                                className="form-input"
                                placeholder="0.00"
                                value={formData.cost_price}
                                onChange={handleChange}
                            />
                        </div>
                    </div>
                    {/* Profit Calculation Display */}
                    {(() => {
                        const reg = parseFloat(formData.regular_price) || 0;
                        const sale = parseFloat(formData.sale_price) || 0;
                        const cost = parseFloat(formData.cost_price) || 0;

                        // Avoid showing if no prices set
                        if (reg === 0 && cost === 0) return null;

                        const effectivePrice = sale > 0 ? sale : reg;
                        const profit = effectivePrice - cost;
                        const margin = effectivePrice > 0 ? ((profit / effectivePrice) * 100) : 0;
                        const minMargin = parseFloat(settings.minProfitMargin) || 0;
                        const isLowMargin = margin < minMargin;

                        return (
                            <div style={{
                                display: 'flex',
                                gap: '2rem',
                                padding: '8px 12px',
                                background: 'rgba(255,255,255,0.03)',
                                borderRadius: '6px',
                                marginTop: '-1rem'
                            }}>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <span className="text-muted" style={{ fontSize: '0.85rem' }}>Est. Profit:</span>
                                    <span style={{
                                        fontWeight: 'bold',
                                        color: isLowMargin ? 'var(--error)' : 'var(--success)'
                                    }}>
                                        ${profit.toFixed(2)}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <span className="text-muted" style={{ fontSize: '0.85rem' }}>Margin:</span>
                                    <span style={{
                                        fontWeight: 'bold',
                                        color: isLowMargin ? 'var(--error)' : 'var(--success)'
                                    }}>
                                        {margin.toFixed(1)}%
                                    </span>
                                    {minMargin > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>(Target: {minMargin}%)</span>}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Linked Products / Recipe Section */}
                    {['simple', 'variable', 'bundle'].includes(formData.type) && (
                        <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                            <h4 style={{ marginBottom: '1rem', fontWeight: '500', fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Package size={16} /> Linked Products (Recipe)
                            </h4>

                            <div style={{ position: 'relative', marginBottom: '1rem' }}>
                                <div className="input-wrapper">
                                    <Search size={16} className="input-icon" style={{ left: '12px' }} />
                                    <input
                                        className="form-input"
                                        style={{ paddingLeft: '36px' }}
                                        placeholder="Search for products to link..."
                                        value={recipeSearch}
                                        onChange={e => handleSearchRecipe(e.target.value)}
                                    />
                                </div>
                                {searchResult.length > 0 && (
                                    <div className="glass-panel" style={{
                                        position: 'absolute', top: '100%', left: 0, width: '100%',
                                        zIndex: 50, marginTop: '4px', maxHeight: '200px', overflowY: 'auto'
                                    }}>
                                        {searchResult.map(res => (
                                            <div
                                                key={res.id}
                                                className="dropdown-item"
                                                style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                                onClick={() => addComponent(res)}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <div style={{ fontWeight: 500 }}>{res.name}</div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>SKU: {res.sku || '-'} | Stock: {res.stock_quantity ?? 'N/A'}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {recipeComponents.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 0.5fr', padding: '0 8px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                        <span>Component</span>
                                        <span>Qty</span>
                                        <span></span>
                                    </div>
                                    {recipeComponents.map(comp => (
                                        <div key={comp.child_id} style={{
                                            display: 'grid', gridTemplateColumns: '3fr 1fr 0.5fr', alignItems: 'center', gap: '8px',
                                            background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '6px'
                                        }}>
                                            <div>
                                                <div style={{ fontWeight: 500 }}>{comp.name}</div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{comp.sku}</div>
                                            </div>
                                            <input
                                                type="number"
                                                className="form-input"
                                                style={{ padding: '4px', height: '30px' }}
                                                value={comp.quantity}
                                                min="1"
                                                onChange={e => updateComponentQty(comp.child_id, e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => removeComponent(comp.child_id)}
                                                className="btn-icon"
                                                style={{ color: 'var(--danger)', marginLeft: 'auto' }}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                    No components added yet.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Inventory */}
                    <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                        <h4 style={{ marginBottom: '1rem', fontWeight: '500', fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Inventory Management</h4>

                        <div style={{ display: 'flex', gap: '2rem', marginBottom: '1rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                                <input
                                    type="checkbox"
                                    name="manage_stock"
                                    checked={formData.manage_stock}
                                    onChange={handleChange}
                                />
                                Manage Stock Level
                            </label>
                        </div>

                        {formData.manage_stock && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                                <label className="input-label">Stock Quantity</label>
                                <input
                                    type="number"
                                    name="stock_quantity"
                                    className="form-input"
                                    style={{ width: '150px' }}
                                    value={formData.stock_quantity}
                                    onChange={handleChange}
                                />
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label className="input-label">Stock Status</label>
                                <select
                                    name="stock_status"
                                    className="form-input"
                                    value={formData.stock_status}
                                    onChange={handleChange}
                                >
                                    <option value="instock">In Stock</option>
                                    <option value="outofstock">Out of Stock</option>
                                    <option value="onbackorder">On Backorder</option>
                                </select>
                            </div>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label className="input-label">Bin Location</label>
                                <input
                                    name="bin_location"
                                    className="form-input"
                                    placeholder="e.g. A-12"
                                    value={formData.bin_location}
                                    onChange={handleChange}
                                />
                            </div>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label className="input-label">Supplier</label>
                                <select
                                    name="supplier_id"
                                    className="form-input"
                                    value={formData.supplier_id}
                                    onChange={handleChange}
                                >
                                    <option value="">-- None --</option>
                                    {suppliers.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Tax configuration */}
                    <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                        <h4 style={{ marginBottom: '1rem', fontWeight: '500', fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tax Configuration</h4>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label className="input-label">Tax Status</label>
                                <select
                                    name="tax_status"
                                    className="form-input"
                                    value={formData.tax_status}
                                    onChange={handleChange}
                                >
                                    <option value="taxable">Taxable</option>
                                    <option value="shipping">Shipping only</option>
                                    <option value="none">None</option>
                                </select>
                            </div>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label className="input-label">Tax Class</label>
                                <select
                                    name="tax_class"
                                    className="form-input"
                                    value={formData.tax_class}
                                    onChange={handleChange}
                                >
                                    <option value="">Standard</option>
                                    {taxRates.map(rate => (
                                        <option key={rate.id} value={rate.class}>{rate.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Description */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label className="input-label">Short Description</label>
                        <textarea
                            name="short_description"
                            className="form-input"
                            rows="2"
                            value={formData.short_description}
                            onChange={handleChange}
                            style={{ resize: 'vertical' }}
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label className="input-label">Description</label>
                        <textarea
                            name="description"
                            className="form-input"
                            rows="4"
                            value={formData.description}
                            onChange={handleChange}
                            style={{ resize: 'vertical' }}
                        />
                    </div>

                    <div className="modal-footer">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn"
                            disabled={isSaving}
                            style={{ background: 'transparent' }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={isSaving}
                        >
                            {isSaving ? <><Loader size={18} className="animate-spin" style={{ marginRight: '8px' }} /> Creating...</> : <><Save size={18} style={{ marginRight: '8px' }} /> Create Product</>}
                        </button>
                    </div>

                </form>
            </div >
        </div >
    );
};

export default CreateProduct;
