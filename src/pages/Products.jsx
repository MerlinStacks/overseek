import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Dexie from 'dexie';
import { db } from '../db/db';
import { Package, Search, Trash2, CheckSquare, Square, Tag, Plus, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast, Toaster } from 'sonner';
import ColumnSelector from '../components/ColumnSelector';
import Pagination from '../components/Pagination';
import { useSettings } from '../context/SettingsContext';
import { batchProducts } from '../services/api';
import { useSortableData } from '../hooks/useSortableData';
import './Products.css';

import CreateProduct from './CreateProduct';

import { useAccount } from '../context/AccountContext';

const Products = () => {
    const { settings } = useSettings();
    const { activeAccount } = useAccount();

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIds, setSelectedIds] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(15);
    const navigate = useNavigate();

    const [statusFilter, setStatusFilter] = useState('all');

    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, statusFilter]);

    const [sortConfig, setSortConfig] = useState({ key: 'date_created', direction: 'desc' });

    // DB-Side Pagination & Filtering
    const { items: paginatedProducts = [], totalItems = 0 } = useLiveQuery(async () => {
        if (!activeAccount) return { items: [], totalItems: 0 };

        let collection = db.products.where('account_id').equals(activeAccount.id);

        // 1. Search (Prioritized)
        if (searchTerm.length > 1) {
            // Use compound index for fast prefix search
            // Note: Dexie compound index usage requires matching the array structure.
            // But we can also use the collection filter if we want flexibility or start with the index.
            // For now, let's keep it robust with a filter on the account collection to ensure isolation.
            // Optimized: Use the [account_id+name] index if possible.
            collection = db.products.where('[account_id+name]')
                .between(
                    [activeAccount.id, searchTerm],
                    [activeAccount.id, searchTerm + '\uffff'],
                    true,
                    true
                );
        }

        // 2. Status Filter
        if (statusFilter !== 'all') {
            collection = collection.filter(p => {
                if (statusFilter === 'instock') return p.stock_status === 'instock';
                if (statusFilter === 'outofstock') return p.stock_status === 'outofstock';
                return true;
            });
        }

        // 3. Sorting (Manual if not using specific index, otherwise use reverse())
        // Dexie collections are naturally sorted by the index used.
        // If we used [account_id+name], it's sorted by name.
        // If generic, we can use reverse().

        // For precise sorting on other keys, we need to convert to array first OR use an index.
        // Since "Large Data" is the goal, we should ideally use an index.
        // We have [account_id+date_created]. 

        let finalCollection = collection;

        // Count before pagination
        const count = await finalCollection.count();

        // 4. Pagination
        const offset = (currentPage - 1) * itemsPerPage;

        // Note: Dexie sorting after filtering/searching complex queries often requires into-memory sort 
        // unless the query PLAN aligns perfectly.
        // For "Solid" MVP: We apply offset/limit.
        // If sorting by date_created:
        if (!searchTerm && sortConfig.key === 'date_created') {
            // We can optimize the Default View (most common)
            finalCollection = db.products.where('[account_id+date_created]')
                .between([activeAccount.id, Dexie.minKey], [activeAccount.id, Dexie.maxKey]);
            if (sortConfig.direction === 'desc') finalCollection = finalCollection.reverse();

            // Re-apply status filter if needed (inefficient if large scan, but better than ALL memory)
            if (statusFilter !== 'all') {
                finalCollection = finalCollection.filter(p => {
                    if (statusFilter === 'instock') return p.stock_status === 'instock';
                    if (statusFilter === 'outofstock') return p.stock_status === 'outofstock';
                    return true;
                });
            }
        }

        const items = await finalCollection
            .offset(offset)
            .limit(itemsPerPage)
            .toArray();

        // Manual sort for non-indexed fields (page-level only, which is fast)
        // If we searched, we lost the date sort.
        if (searchTerm || sortConfig.key !== 'date_created') {
            items.sort((a, b) => {
                const aVal = a[sortConfig.key];
                const bVal = b[sortConfig.key];
                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        return { items, totalItems: count };

    }, [activeAccount, searchTerm, currentPage, itemsPerPage, statusFilter, sortConfig]) || {};

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const totalPages = Math.ceil(totalItems / itemsPerPage);

    const formatPrice = (price) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price || 0);
    };

    const handleAddTag = async (productId, currentTags) => {
        const tag = window.prompt("Enter new tag:");
        if (tag) {
            const newTags = currentTags ? [...currentTags, tag] : [tag];
            await db.products.update(productId, { local_tags: newTags });
        }
    };


    const toggleSelectAll = () => {
        if (selectedIds.length === paginatedProducts.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(paginatedProducts.map(p => p.id));
        }
    };

    const toggleSelect = (id) => {
        if (selectedIds.includes(id)) {
            setSelectedIds(prev => prev.filter(pid => pid !== id));
        } else {
            setSelectedIds(prev => [...prev, id]);
        }
    };

    const handleBulkAction = async (action) => {
        if (!window.confirm(`Apply '${action}' to ${selectedIds.length} products?`)) return;

        setIsProcessing(true);
        try {
            let payload = {};

            if (action === 'delete') {
                payload.delete = selectedIds;
                await db.products.bulkDelete(selectedIds);
            } else if (action === 'instock') {
                payload.update = selectedIds.map(id => ({ id, stock_status: 'instock' }));
                await db.products.where('id').anyOf(selectedIds).modify({ stock_status: 'instock' });
            } else if (action === 'outofstock') {
                payload.update = selectedIds.map(id => ({ id, stock_status: 'outofstock' }));
                await db.products.where('id').anyOf(selectedIds).modify({ stock_status: 'outofstock' });
            }

            await batchProducts(settings, payload);
            toast.success(`Bulk action '${action}' completed.`);
            if (action === 'delete') setSelectedIds([]);
        } catch (error) {
            console.error(error);
            toast.error("Failed to perform bulk action.");
        } finally {
            setIsProcessing(false);
        }
    };

    const allColumns = [
        {
            id: 'select',
            label: 'Select',
            sortKey: null,
            width: '40px',
            header: () => (
                <div
                    onClick={toggleSelectAll}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.7 }}
                >
                    {selectedIds.length > 0 && selectedIds.length === paginatedProducts.length ? (
                        <CheckSquare size={18} color="var(--primary)" />
                    ) : (
                        <Square size={18} />
                    )}
                </div>
            ),
            render: (product) => {
                const isSelected = selectedIds.includes(product.id);
                return (
                    <div
                        onClick={() => toggleSelect(product.id)}
                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: isSelected ? 1 : 0.5 }}
                    >
                        {isSelected ? (
                            <CheckSquare size={18} color="var(--primary)" />
                        ) : (
                            <Square size={18} />
                        )}
                    </div>
                );
            }
        },
        {
            id: 'product',
            label: 'Product',
            sortKey: 'name',
            render: (product) => {
                const image = product.images && product.images[0] ? product.images[0].src : null;
                return (
                    <div className="product-image-cell">
                        {image ? (
                            <img src={image} alt={product.name} className="product-thumb" referrerPolicy="no-referrer" loading="lazy" />
                        ) : (
                            <div className="product-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Package size={20} className="text-muted" />
                            </div>
                        )}
                        <span className="product-name">{product.name}</span>
                    </div>
                );
            }
        },
        {
            id: 'status',
            label: 'Status',
            sortKey: 'status',
            render: (product) => (
                <span className={`status-badge status-${product.status}`}>
                    {product.status}
                </span>
            )
        },
        {
            id: 'stock',
            label: 'Stock',
            sortKey: 'stock_quantity',
            render: (product) => (
                <span className="stock-text">
                    {product.stock_quantity || '∞'} in stock
                </span>
            )
        },
        {
            id: 'price',
            label: 'Price',
            sortKey: 'price',
            render: (product) => <span className="price-text">{formatPrice(product.price)}</span>
        },
        {
            id: 'tags',
            label: 'Tags',
            sortKey: null,
            render: (product) => (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', maxWidth: '150px' }}>
                    {(product.tags || []).map((tag) => (
                        <span key={`wc-${tag.id}`} className="status-badge" style={{ fontSize: '0.75rem', padding: '2px 6px', background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa' }}>
                            {tag.name}
                        </span>
                    ))}
                    {(product.local_tags || []).map((tag, idx) => (
                        <span key={`local-${idx}`} className="status-badge" style={{ fontSize: '0.75rem', padding: '2px 6px', background: 'rgba(255,255,255,0.1)' }}>
                            {tag}
                        </span>
                    ))}
                    <button
                        className="btn-icon-sm"
                        style={{ padding: '2px', opacity: 0.5, cursor: 'pointer', border: 'none', background: 'transparent', color: 'inherit' }}
                        onClick={() => handleAddTag(product.id, product.local_tags)}
                        title="Add Tag"
                    >
                        <Plus size={14} />
                    </button>
                </div>
            )
        },
        {
            id: 'date',
            label: 'Date',
            sortKey: 'date_created',
            render: (product) => <span className="text-muted">{new Date(product.date_created).toLocaleDateString()}</span>
        },
        {
            id: 'actions',
            label: 'Actions',
            sortKey: null,
            render: (product) => (
                <button
                    className="btn"
                    style={{ padding: '0.4rem 0.8rem', background: 'rgba(255,255,255,0.05)', fontSize: '0.85rem' }}
                    onClick={() => navigate(`/products/${product.id}`)}
                >
                    View
                </button>
            )
        }
    ];

    const [visibleColumnIds, setVisibleColumnIds] = useState(() => {
        const saved = localStorage.getItem('products_columns');
        return saved ? JSON.parse(saved) : ['select', 'product', 'status', 'stock', 'price', 'tags', 'date', 'actions'];
    });

    const activeColumns = allColumns.filter(col => visibleColumnIds.includes(col.id));

    const handleColumnChange = (newIds) => {
        setVisibleColumnIds(newIds);
        localStorage.setItem('products_columns', JSON.stringify(newIds));
    };

    return (
        <div className="products-page">
            <Toaster position="top-right" theme="dark" />

            <div className="products-header">
                <div className="header-content">
                    <div className="products-icon-wrapper">
                        <Package size={32} />
                    </div>
                    <div className="products-title">
                        <h2>Products</h2>
                        <p>Manage your store inventory.</p>
                    </div>
                </div>

                {/* Controls Area */}
                <div className="products-controls">
                    {selectedIds.length > 0 && (
                        <div className="bulk-actions-wrapper">
                            <span className="selected-count">
                                {selectedIds.length} selected
                            </span>

                            <button
                                onClick={() => handleBulkAction('instock')}
                                disabled={isProcessing}
                                className="btn btn-icon-only success"
                                title="Set In Stock"
                            >
                                <CheckSquare size={16} />
                            </button>
                            <button
                                onClick={() => handleBulkAction('outofstock')}
                                disabled={isProcessing}
                                className="btn btn-icon-only warning"
                                title="Set Out of Stock"
                            >
                                <Square size={16} />
                            </button>
                            <div className="vertical-divider"></div>
                            <button
                                onClick={() => handleBulkAction('delete')}
                                disabled={isProcessing}
                                className="btn btn-icon-only danger"
                                title="Delete"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    )}

                    <ColumnSelector
                        availableColumns={allColumns}
                        visibleColumns={visibleColumnIds}
                        onChange={handleColumnChange}
                    />

                    {/* Filters */}
                    <div className="filter-wrapper">
                        <select
                            className="form-input status-select"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="all">All Status</option>
                            <option value="instock">In Stock</option>
                            <option value="outofstock">Out of Stock</option>
                        </select>
                    </div>

                    <div className="input-wrapper search-wrapper">
                        <input
                            type="text"
                            placeholder="Search products..."
                            className="form-input"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <Search className="input-icon" size={18} />
                    </div>
                    <button onClick={() => setIsCreateModalOpen(true)} className="btn btn-primary create-btn">
                        <Package size={18} /> <span className="btn-text">Create Product</span>
                    </button>
                </div>
            </div>

            <div className="glass-panel products-table-container">
                <table className="products-table">
                    <thead>
                        <tr>
                            {activeColumns.map(col => {
                                const isActive = sortConfig?.key === col.sortKey;
                                return (
                                    <th
                                        key={col.id}
                                        style={col.width ? { width: col.width } : {}}
                                        onClick={() => col.sortKey && requestSort(col.sortKey)}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: col.sortKey ? 'pointer' : 'default', opacity: col.sortKey ? 1 : 0.9 }}>
                                            {col.header ? col.header() : col.label}
                                            {col.sortKey && (
                                                isActive ? (
                                                    sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                                                ) : (
                                                    <ArrowUpDown size={14} style={{ opacity: 0.3 }} />
                                                )
                                            )}
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedProducts.length > 0 ? (
                            paginatedProducts.map(product => {
                                const isSelected = selectedIds.includes(product.id);
                                return (
                                    <tr key={product.id} className={isSelected ? 'row-selected' : ''} style={{ background: isSelected ? 'rgba(99, 102, 241, 0.05)' : 'transparent' }}>
                                        {activeColumns.map(col => (
                                            <td key={`${product.id}-${col.id}`} data-label={col.label}>
                                                {/* For mobile label display */}
                                                <span className="mobile-label" style={{ display: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', marginRight: '8px' }}>
                                                    {col.label}:
                                                </span>
                                                {col.render(product)}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td colSpan={activeColumns.length} style={{ textAlign: 'center', padding: '3rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', color: 'var(--text-muted)' }}>
                                        <Package size={48} style={{ opacity: 0.5 }} />
                                        <p>No products found in local database.</p>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    itemsPerPage={itemsPerPage}
                    onPageChange={setCurrentPage}
                    onItemsPerPageChange={setItemsPerPage}
                    totalItems={totalItems}
                />
            </div>
            {isCreateModalOpen && (
                <CreateProduct onClose={() => setIsCreateModalOpen(false)} />
            )}
        </div>
    );
};

export default Products;
