import React from 'react';
import { Edit2 } from 'lucide-react';

const ProductVariationList = ({
    variations,
    loading,
    editingVariation,
    setEditingVariation,
    variationForm,
    setVariationForm,
    handleSaveVariation,
    savingVariation,
    formatCurrency
}) => {
    if (loading) return <p className="text-muted">Loading variations...</p>;

    return (
        <div className="glass-panel-card">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '1rem' }}>Variations</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {variations.length === 0 && <p className="text-muted">No variations found.</p>}

                {variations.map(variation => (
                    <div key={variation.id} className="variation-item" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px' }}>
                        {/* Header Row */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontWeight: '500' }}>
                                {variation.attributes.map(a => `${a.name}: ${a.option}`).join(', ') || `ID: ${variation.id}`}
                                {(!editingVariation || editingVariation !== variation.id) && (
                                    <span className="text-muted" style={{ marginLeft: '8px', fontSize: '0.9rem' }}>
                                        {variation.sku}
                                        <span style={{ color: 'var(--primary)', marginLeft: '8px' }}>
                                            Bin: {variation.meta_data?.find(m => m.key === '_bin_location')?.value || '-'}
                                        </span>
                                    </span>
                                )}
                            </div>

                            {editingVariation !== variation.id && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <span style={{ fontWeight: 'bold' }}>{formatCurrency(variation.price)}</span>
                                    <span style={{ fontSize: '0.8rem', color: variation.stock_status === 'instock' ? '#34d399' : '#f87171' }}>
                                        {variation.stock_status === 'instock' ? `In Stock (${variation.stock_quantity ?? '∞'})` : 'Out Of Stock'}
                                    </span>
                                    {/* startEditVariation logic should be handled by parent or wrapper */}
                                    <button onClick={() => setEditingVariation(variation)} className="btn-icon">
                                        <Edit2 size={16} />
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Edit Form Inline */}
                        {editingVariation === variation.id && (
                            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr auto auto', gap: '8px', alignItems: 'end' }}>
                                <div>
                                    <label className="form-label" style={{ fontSize: '0.7rem' }}>Reg</label>
                                    <input type="number" className="form-input" style={{ padding: '4px' }} value={variationForm.regular_price} onChange={e => setVariationForm({ ...variationForm, regular_price: e.target.value })} />
                                </div>
                                <div>
                                    <label className="form-label" style={{ fontSize: '0.7rem' }}>Sale</label>
                                    <input type="number" className="form-input" style={{ padding: '4px' }} value={variationForm.sale_price} onChange={e => setVariationForm({ ...variationForm, sale_price: e.target.value })} />
                                </div>
                                <div>
                                    <label className="form-label" style={{ fontSize: '0.7rem' }}>SKU</label>
                                    <input className="form-input" style={{ padding: '4px' }} value={variationForm.sku} onChange={e => setVariationForm({ ...variationForm, sku: e.target.value })} />
                                </div>
                                <div>
                                    <label className="form-label" style={{ fontSize: '0.7rem' }}>Bin</label>
                                    <input className="form-input" style={{ padding: '4px' }} value={variationForm.bin_location || ''} onChange={e => setVariationForm({ ...variationForm, bin_location: e.target.value })} />
                                </div>
                                <div>
                                    <label className="form-label" style={{ fontSize: '0.7rem' }}>Stock</label>
                                    <select className="form-input" style={{ padding: '4px' }} value={variationForm.stock_status} onChange={e => setVariationForm({ ...variationForm, stock_status: e.target.value })}>
                                        <option value="instock">In Stock</option>
                                        <option value="outofstock">Out</option>
                                        <option value="onbackorder">Backorder</option>
                                    </select>
                                </div>

                                {variationForm.stock_status === 'instock' && (
                                    <div>
                                        <label className="form-label" style={{ fontSize: '0.7rem' }}>Qty</label>
                                        <input type="number" className="form-input" style={{ padding: '4px', width: '60px' }} value={variationForm.stock_quantity || ''} onChange={e => setVariationForm({ ...variationForm, stock_quantity: e.target.value })} />
                                    </div>
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
        </div>
    );
};

export default ProductVariationList;
