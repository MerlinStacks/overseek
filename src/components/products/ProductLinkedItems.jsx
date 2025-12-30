import React from 'react';
import { Link, Trash2, Search } from 'lucide-react';

const ProductLinkedItems = ({
    linkedComponents,
    childProducts, // Array of product objects from DB corresponding to child_ids
    linkSearchTerm,
    setLinkSearchTerm,
    linkSearchResults = [], // Array of search results
    handleAddLinkedProduct,
    handleRemoveLinkedProduct,
    handleUpdateLinkQty
}) => {
    return (
        <div className="glass-panel-card">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Link size={18} color="var(--primary)" /> Linked Products (Recipe)
            </h3>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '1rem', position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '10px', color: '#94a3b8' }} />
                <input
                    className="form-input"
                    placeholder="Search for products to link..."
                    style={{ paddingLeft: '34px' }}
                    value={linkSearchTerm}
                    onChange={e => setLinkSearchTerm(e.target.value)}
                />

                {linkSearchResults.length > 0 && (
                    <div className="glass-panel" style={{ position: 'absolute', top: '100%', left: 0, width: '100%', maxHeight: '200px', overflowY: 'auto', zIndex: 50 }}>
                        {linkSearchResults.map(res => (
                            <div
                                key={res.id}
                                onClick={() => handleAddLinkedProduct(res.id)}
                                style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                {res.name} <span className="text-muted" style={{ fontSize: '0.8rem' }}>(ID: {res.id})</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {linkedComponents.length === 0 && <p className="text-muted" style={{ fontStyle: 'italic' }}>No linked products.</p>}

                {linkedComponents.map(comp => {
                    const p = childProducts.find(cp => cp.id === comp.child_id);
                    return (
                        <div key={comp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontWeight: 500 }}>{p ? p.name : `Unknown Product (${comp.child_id})`}</span>
                            </div>

                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <span className="text-muted" style={{ fontSize: '0.8rem' }}>Qty:</span>
                                <input
                                    type="number"
                                    className="form-input"
                                    style={{ width: '60px', padding: '4px', textAlign: 'center' }}
                                    value={comp.quantity}
                                    onChange={e => handleUpdateLinkQty(comp.id, e.target.value)}
                                />
                                <button onClick={() => handleRemoveLinkedProduct(comp.id)} className="btn-icon" style={{ color: 'var(--danger)' }}>
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ProductLinkedItems;
