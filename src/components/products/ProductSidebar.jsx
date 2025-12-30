import React from 'react';
import SEOScore from '../SEOScore';

const ProductSidebar = ({
    isEditing,
    product,
    editForm,
    setEditForm,
    stockInfo,
    suppliers,
    storeUnits,
    images
}) => {
    return (
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
                        main_image: images && images[0] ? images[0].src : null,
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
            </div>
        </div>
    );
};

export default ProductSidebar;
