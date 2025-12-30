import React, { useState } from 'react';
import DOMPurify from 'dompurify';

const ProductGeneralInfo = ({
    isEditing,
    product,
    editForm,
    setEditForm,
    formatCurrency,
    settings,
    activeAccount,
    storeUnits
}) => {
    const [descTab, setDescTab] = useState('visual');

    return (
        <div className="product-general-info">
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
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: '16px', alignItems: 'end' }}>
                            {/* Gold Price Toggle */}
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
        </div>
    );
};

export default ProductGeneralInfo;
