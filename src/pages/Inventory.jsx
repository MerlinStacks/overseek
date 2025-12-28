import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useSortableData } from '../hooks/useSortableData';
import { Package, Search, Plus, Trash2, ArrowRight, AlertCircle, Edit2, Layers, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { useAccount } from '../context/AccountContext';
import Pagination from '../components/Pagination';
import './Inventory.css';

/**
 * Inventory Manager Page
 * Allows defining "Recipes" for products (e.g. 1 Gift Box = 2 Soaps + 1 Shampoo)
 */
const Inventory = () => {
    const { activeAccount } = useAccount();

    // Filter State
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('composite'); // Default to showing recipes only

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(15);
    const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });

    // Modal State
    const [selectedProduct, setSelectedProduct] = useState(null); // Product being edited
    const [isEditOpen, setIsEditOpen] = useState(false);

    // Expansion State
    const [expandedIds, setExpandedIds] = useState(new Set());
    const toggleExpand = (id) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Reset page on filter change
    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, filterType]);

    // Data Queries
    const { data: { items: sortedItems, totalItems } = { items: [], totalItems: 0 }, isLoading } = useLiveQuery(async () => {
        if (!activeAccount) return { items: [], totalItems: 0 };

        // 1. Fetch needed components
        const allComponents = await db.product_components.where('account_id').equals(activeAccount.id).toArray();
        const parentIds = new Set(allComponents.map(c => c.parent_id));
        const childIds = new Set(allComponents.map(c => c.child_id));

        // 2. Build Query
        let collection = db.products.where('account_id').equals(activeAccount.id);

        if (searchTerm.length > 1) {
            collection = db.products.where('[account_id+name]')
                .between(
                    [activeAccount.id, searchTerm],
                    [activeAccount.id, searchTerm + '\uffff'],
                    true, true
                );
        }

        let finalCollection = collection;

        // Apply Filter Function
        finalCollection = finalCollection.filter(p => {
            // Search Logic
            if (searchTerm.length > 1) {
                // ... logic handled by 'between' mostly, but filter maintains robustness
            } else {
                // Type Filtering
                if (filterType === 'composite' && !parentIds.has(p.id)) return false;
                if (filterType === 'component' && !childIds.has(p.id)) return false;
                if (filterType === 'variation' && p.type !== 'variation') return false;
            }

            // HIERARCHY RULE:
            // If showing "All" or "Composite" or "Component", we only show PARENTS (Root nodes).
            // Variants are hidden unless explicitly filtering for 'variation'.
            if (filterType !== 'variation' && p.parent_id) return false;

            return true;
        });

        // Count
        const count = await finalCollection.count();

        // Paginate Parents
        const offset = (currentPage - 1) * itemsPerPage;
        const products = await finalCollection.offset(offset).limit(itemsPerPage).toArray();

        // 3. Fetch Variants for this Page (Hierarchy)
        // We only fetch variants if we are NOT in 'variation' mode (where we show them flat)
        let variantsMap = new Map();
        if (filterType !== 'variation') {
            const pageParentIds = products.map(p => p.id);
            // Scan for variants of these parents
            const pageVariants = await db.products
                .where('account_id').equals(activeAccount.id)
                .filter(p => pageParentIds.includes(p.parent_id))
                .toArray();

            pageVariants.forEach(v => {
                if (!variantsMap.has(v.parent_id)) variantsMap.set(v.parent_id, []);
                variantsMap.get(v.parent_id).push(v);
            });
        }

        // 4. Process (Calculations)
        const processed = products.map(p => {
            // Attach Variants
            const myVariants = variantsMap.get(p.id) || [];

            // Component Logic
            const myComponents = allComponents.filter(c => c.parent_id === p.id);

            return {
                ...p,
                _myComponents: myComponents,
                _variants: myVariants
            };
        });

        // 5. Batch Fetch needed component children for stock calc
        const neededChildIds = new Set();
        processed.forEach(p => {
            p._myComponents.forEach(c => neededChildIds.add(c.child_id));
        });

        const childProductsMap = new Map();
        if (neededChildIds.size > 0) {
            const childKeys = Array.from(neededChildIds).map(id => [activeAccount.id, id]);
            const children = await db.products.where('[account_id+id]').anyOf(childKeys).toArray();
            children.forEach(c => childProductsMap.set(c.id, c));
        }

        // Final Mapping
        const finalItems = processed.map(p => {
            const _isComposite = parentIds.has(p.id);
            const _isComponent = childIds.has(p.id);

            let maxBuildable = 9999;

            if (_isComposite) {
                const myComps = p._myComponents;
                if (myComps.length > 0) {
                    let minCap = Infinity;
                    myComps.forEach(comp => {
                        const child = childProductsMap.get(comp.child_id);
                        if (!child) return;
                        if (child.stock_status === 'onbackorder') return;
                        if (child.stock_quantity === null && child.stock_status === 'instock') return;
                        const childQty = child.stock_quantity || 0;
                        const canMake = Math.floor(childQty / comp.quantity);
                        if (canMake < minCap) minCap = canMake;
                    });
                    maxBuildable = minCap === Infinity ? 9999 : minCap;
                } else {
                    maxBuildable = p.stock_quantity || 0;
                }
            } else {
                maxBuildable = p.stock_quantity || 0;
            }

            let typeLabel = '-';
            if (_isComposite) typeLabel = 'Bundle';
            else if (_isComponent) typeLabel = 'Component';
            else if (p.type === 'variable') typeLabel = 'Variable'; // Parent
            else if (p.type === 'variation') typeLabel = 'Variation';

            return {
                ...p,
                typeLabel,
                potentialStock: maxBuildable,
                _isComposite,
                _isComponent
            };
        });

        // Page-Level Sort
        if (sortConfig.key) {
            finalItems.sort((a, b) => {
                let aVal = a[sortConfig.key];
                let bVal = b[sortConfig.key];
                if (typeof aVal === 'string') aVal = aVal.toLowerCase();
                if (typeof bVal === 'string') bVal = bVal.toLowerCase();
                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        return { items: finalItems, totalItems: count };

    }, [activeAccount, searchTerm, filterType, currentPage, itemsPerPage, sortConfig]);

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        setSortConfig({ key, direction });
    };

    // Helper for Header
    const SortableHeader = ({ label, sortKey, align = 'left' }) => {
        const isActive = sortConfig?.key === sortKey;
        return (
            <th
                onClick={() => sortKey && requestSort(sortKey)}
                style={{ cursor: sortKey ? 'pointer' : 'default', userSelect: 'none', textAlign: align }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
                    {label}
                    {sortKey && (
                        isActive ? (
                            sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                        ) : (
                            <ArrowUpDown size={14} style={{ opacity: 0.3 }} />
                        )
                    )}
                </div>
            </th>
        );
    };

    return (
        <div className="inventory-page">
            <Toaster position="top-right" theme="dark" />

            <div className="inventory-header">
                <div className="header-content">
                    <div className="inventory-icon-wrapper">
                        <Layers size={32} />
                    </div>
                    <div className="inventory-title">
                        <h2>Inventory Recipes</h2>
                        <p>Define product compositions and calculated stock.</p>
                    </div>
                </div>

                <div className="inventory-controls">
                    <div className="input-wrapper search-wrapper">
                        <input
                            className="form-input"
                            placeholder="Search products..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        <Search className="input-icon" size={18} />
                    </div>

                    <div className="tools-wrapper">
                        <select
                            className="form-input filter-select"
                            value={filterType}
                            onChange={e => setFilterType(e.target.value)}
                        >
                            <option value="all">All Products</option>
                            <option value="composite">Bundles</option>
                            <option value="component">Components</option>
                            <option value="variation">Variations</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="glass-panel inventory-table-container">
                <table className="inventory-table">
                    <thead>
                        <tr>
                            <SortableHeader label="Product" sortKey="name" />
                            <SortableHeader label="Type" sortKey="typeLabel" />
                            <SortableHeader label="Physical Stock" sortKey="stock_quantity" />
                            <SortableHeader label="Calculated Stock" sortKey="potentialStock" />
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedItems.map(product => {
                            const hasVariants = product._variants && product._variants.length > 0;
                            const isExpanded = expandedIds.has(product.id);

                            return (
                                <React.Fragment key={product.id}>
                                    <tr>
                                        <td data-label="Product">
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                                                {hasVariants && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); toggleExpand(product.id); }}
                                                        className="btn-icon"
                                                        style={{ padding: 0, height: 'fit-content', marginTop: '4px', cursor: 'pointer', minWidth: '20px' }}
                                                    >
                                                        {isExpanded ? <ArrowUp size={16} style={{ opacity: 0.7 }} /> : <ArrowDown size={16} style={{ opacity: 0.7 }} />}
                                                    </button>
                                                )}
                                                {!hasVariants && <div style={{ width: 20 }}></div>}
                                                <div>
                                                    <div style={{ fontWeight: 600 }}>{product.name}</div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>SKU: {product.sku || 'N/A'}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td data-label="Type">
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                {product._isComposite && <span className="chip chip-purple">Bundle</span>}
                                                {product._isComponent && <span className="chip chip-blue">Component</span>}
                                                {product.type === 'variable' && <span className="chip" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}>Variable</span>}
                                                {!product._isComposite && !product._isComponent && product.type !== 'variable' && <span style={{ color: 'var(--text-muted)' }}>-</span>}
                                            </div>
                                        </td>
                                        <td data-label="Physical Stock" style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                                            {product.stock_quantity ?? '∞'}
                                        </td>
                                        <td data-label="Calculated Stock" style={{ fontFamily: 'monospace' }}>
                                            {product._isComposite ? (
                                                <span style={{ color: product.potentialStock === 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 'bold' }}>
                                                    {product.potentialStock}
                                                </span>
                                            ) : '-'}
                                        </td>
                                        <td data-label="Actions" style={{ textAlign: 'right' }}>
                                            <button
                                                onClick={() => { setSelectedProduct(product); setIsEditOpen(true); }}
                                                className="btn"
                                                style={{ padding: '0.4rem 0.8rem', background: 'rgba(255,255,255,0.05)', fontSize: '0.85rem' }}
                                                title="Edit Recipe"
                                            >
                                                <Layers size={16} /> Edit Recipe
                                            </button>
                                        </td>
                                    </tr>
                                    {/* Nested Variants */}
                                    {isExpanded && product._variants?.map(v => (
                                        <tr key={v.id} style={{ background: 'rgba(255,255,255,0.02)' }}>
                                            <td style={{ paddingLeft: '50px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--border)' }}></div>
                                                    <div>
                                                        <div style={{ fontWeight: 400, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                                            {v.name.replace(product.name, '').replace(/^[\s-\.]+/, '') || v.name}
                                                        </div>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>SKU: {v.sku}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td><span className="chip" style={{ fontSize: '0.75rem', opacity: 0.5, border: '1px solid var(--border)' }}>Variation</span></td>
                                            <td style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                                {v.stock_quantity ?? '∞'}
                                            </td>
                                            <td>-</td>
                                            <td></td>
                                        </tr>
                                    ))}
                                </React.Fragment>
                            );
                        })}
                        {sortedItems.length === 0 && (
                            <tr><td colSpan="5" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>No products found matching filters.</td></tr>
                        )}
                    </tbody>
                </table>
                <Pagination
                    currentPage={currentPage}
                    totalPages={Math.ceil(totalItems / itemsPerPage)}
                    itemsPerPage={itemsPerPage}
                    onPageChange={setCurrentPage}
                    onItemsPerPageChange={setItemsPerPage}
                    totalItems={totalItems}
                />
            </div>

            {/* Edit Modal */}
            {
                isEditOpen && selectedProduct && (
                    <RecipeModal
                        product={selectedProduct}
                        // allProducts removed, modal fetches its own
                        onClose={() => { setIsEditOpen(false); setSelectedProduct(null); }}
                    />
                )
            }
        </div>
    );
};

const RecipeModal = ({ product, onClose }) => {
    const { activeAccount } = useAccount();

    // Fetch existing components for THIS product
    const existingComponents = useLiveQuery(async () => {
        if (!activeAccount) return [];
        return await db.product_components.where('parent_id').equals(product.id).toArray();
    }, [product.id, activeAccount]) || [];

    // Local form state
    const [components, setComponents] = useState([]); // Array of {child_id, quantity}
    const [isSaving, setIsSaving] = useState(false);

    // Sync init
    React.useEffect(() => {
        if (existingComponents) {
            setComponents(existingComponents.map(c => ({
                child_id: c.child_id,
                quantity: c.quantity
            })));
        }
    }, [existingComponents]);

    // Component Search State
    const [compSearch, setCompSearch] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);

    // Add Form State
    const [selectedCompId, setSelectedCompId] = useState('');
    const [quantity, setQuantity] = useState(1);

    // Component Data Fetching (Names/Stock for display list)
    const [componentDetails, setComponentDetails] = useState({});

    // Fetch details for components currently in the list
    React.useEffect(() => {
        const fetchDetails = async () => {
            if (!activeAccount) return;
            const ids = components.map(c => c.child_id);
            if (ids.length === 0) return;
            const keys = ids.map(id => [activeAccount.id, id]);

            const details = await db.products.where('[account_id+id]').anyOf(keys).toArray();
            const map = {};
            details.forEach(d => map[d.id] = d);
            setComponentDetails(prev => ({ ...prev, ...map }));
        };
        fetchDetails();
    }, [components, activeAccount]);

    // Search Effect
    React.useEffect(() => {
        const doSearch = async () => {
            if (compSearch.length < 2) {
                setSearchResults([]);
                return;
            }
            setSearching(true);
            if (activeAccount) {
                // Limit to 20 suggestions
                const results = await db.products.where('[account_id+name]')
                    .between([activeAccount.id, compSearch], [activeAccount.id, compSearch + '\uffff'], true, true)
                    .limit(20)
                    .toArray();

                // Remove self
                setSearchResults(results.filter(r => r.id !== product.id));
            }
            setSearching(false);
        };
        const timer = setTimeout(doSearch, 300);
        return () => clearTimeout(timer);
    }, [compSearch, activeAccount, product.id]);

    const handleAddComponent = (e) => {
        e.preventDefault();
        if (!selectedCompId) return;
        const id = parseInt(selectedCompId);

        if (components.some(c => c.child_id === id)) {
            toast.error("Already in recipe.");
            return;
        }

        setComponents([...components, { child_id: id, quantity: parseInt(quantity) }]);
        setSelectedCompId('');
        setCompSearch('');
        setQuantity(1);
    };

    const handleRemove = (id) => {
        setComponents(components.filter(c => c.child_id !== id));
    };

    const handleSave = async () => {
        if (!activeAccount) return;
        setIsSaving(true);
        try {
            // Transaction
            await db.transaction('rw', db.product_components, async () => {
                // Delete OLD
                const existing = await db.product_components.where('parent_id').equals(product.id).toArray();
                const idsToDelete = existing.filter(e => e.account_id === activeAccount.id).map(e => e.id);
                if (idsToDelete.length > 0) await db.product_components.bulkDelete(idsToDelete);

                // Add NEW
                if (components.length > 0) {
                    const toAdd = components.map(c => ({
                        account_id: activeAccount.id,
                        parent_id: product.id,
                        child_id: c.child_id,
                        quantity: c.quantity
                    }));
                    await db.product_components.bulkAdd(toAdd);
                }
            });

            toast.success("Recipe Saved!");
            onClose();
        } catch (e) {
            console.error(e);
            toast.error("Failed to save.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h2 className="modal-title">Edit Recipe: {product.name}</h2>
                            <p className="modal-desc">Define what makes up this product.</p>
                        </div>
                        <button onClick={onClose} className="btn-icon">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="modal-grid">
                    {/* Left: Component List */}
                    <div>
                        <h3 className="modal-section-title">Components List</h3>
                        <div className="component-list">
                            {components.map(comp => {
                                const details = componentDetails[comp.child_id];
                                return (
                                    <div key={comp.child_id} className="component-item">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div className="quantity-badge">{comp.quantity}x</div>
                                            <div>
                                                <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{details?.name || `Product #${comp.child_id}`}</div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Stock: {details?.stock_quantity ?? '-'}</div>
                                            </div>
                                        </div>
                                        <button onClick={() => handleRemove(comp.child_id)} className="btn-icon" style={{ color: 'var(--danger)' }}>
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                );
                            })}
                            {components.length === 0 && (
                                <div style={{ opacity: 0.5, textAlign: 'center', padding: '2rem' }}>No components.</div>
                            )}
                        </div>
                    </div>

                    {/* Right: Add New */}
                    <div>
                        <h3 className="modal-section-title">Add Component</h3>
                        <form onSubmit={handleAddComponent} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div className="form-group">
                                <label style={{ fontSize: '0.8rem', marginBottom: '6px', display: 'block', color: 'var(--text-muted)' }}>Search Product</label>
                                <div className="input-wrapper">
                                    <input
                                        className="form-input"
                                        placeholder="Type to search..."
                                        value={compSearch}
                                        onChange={e => {
                                            setCompSearch(e.target.value);
                                            // Prepare to select from results
                                            if (selectedCompId) setSelectedCompId('');
                                        }}
                                        style={{ width: '100%' }}
                                    />
                                    <Search size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                                </div>
                                {searchResults.length > 0 && !selectedCompId && (
                                    <div className="search-dropdown" style={{ border: '1px solid var(--border)', maxHeight: '150px', overflowY: 'auto', marginTop: '4px', background: 'var(--card-bg)', borderRadius: '6px' }}>
                                        {searchResults.map(r => (
                                            <div
                                                key={r.id}
                                                style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}
                                                className="hover-bg"
                                                onClick={() => {
                                                    setCompSearch(r.name);
                                                    setSelectedCompId(r.id);
                                                    // Add to local detail cache instantly
                                                    setComponentDetails(prev => ({ ...prev, [r.id]: r }));
                                                    setSearchResults([]);
                                                }}
                                            >
                                                {r.name}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {selectedCompId && (
                                <div className="form-group">
                                    <label style={{ fontSize: '0.8rem', marginBottom: '6px', display: 'block', color: 'var(--text-muted)' }}>Quantity</label>
                                    <input type="number" min="1" className="form-input" value={quantity} onChange={e => setQuantity(e.target.value)} />
                                </div>
                            )}

                            <button type="submit" disabled={!selectedCompId} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                                <Plus size={16} /> Add to Recipe
                            </button>
                        </form>
                    </div>
                </div>

                <div className="modal-footer">
                    <button onClick={onClose} className="btn" style={{ background: 'transparent' }}>Cancel</button>
                    <button onClick={handleSave} disabled={isSaving} className="btn btn-primary">{isSaving ? 'Saving...' : 'Save Recipe'}</button>
                </div>
            </div>
        </div>
    );
};

export default Inventory;
