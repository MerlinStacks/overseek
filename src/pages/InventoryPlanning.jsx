import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useSortableData } from '../hooks/useSortableData';
import { TrendingUp, AlertCircle, Calendar, Truck, CheckCircle, Search, ArrowRight, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';

const InventoryPlanning = () => {
    // 1. Fetch Data
    const products = useLiveQuery(() => db.products.toArray()) || [];
    const suppliers = useLiveQuery(() => db.suppliers.toArray()) || [];
    const components = useLiveQuery(() => db.product_components.toArray()) || [];
    const orders = useLiveQuery(async () => {
        // Fetch orders from last 90 days for velocity algo
        const d = new Date();
        d.setDate(d.getDate() - 90);
        return await db.orders.where('date_created').above(d.toISOString()).toArray();
    }) || [];

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all'); // all, urgent, warning

    // Toggle State for expandable rows
    const [expandedIds, setExpandedIds] = useState(new Set());
    const toggleExpand = (id, e) => {
        if (e) e.stopPropagation();
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // 2. Calculations
    const planningData = useMemo(() => {
        if (!products.length) return [];

        // Exclude actual bundle definitions (parents of components) if that is the intent,
        // but keep Variable Parents to act as containers.
        // Logic: compositeProductIds are IDs of products that HAVE ingredients.
        const compositeProductIds = new Set(components.map(c => c.parent_id));

        const productSales = new Map(); // pid -> total qty sold in 90 days

        orders.forEach(o => {
            if (!o.line_items) return;
            o.line_items.forEach(item => {
                // Fix: Prefer variation_id if present to correctly attribute sales to variants
                const pid = (item.variation_id && item.variation_id > 0) ? item.variation_id : item.product_id;
                const qty = item.quantity || 1;
                productSales.set(pid, (productSales.get(pid) || 0) + qty);
            });
        });

        // 90 Day window
        const DAYS_WINDOW = 90;

        // Step 1: Compute metrics for ALL nodes (flat)
        // We do NOT strictly filter compositeProductIds here if we want to support hierarchal bundles later,
        // but sticking to user request: "Variants under parents".
        // Variable parents usually aren't "composite" in the same way.

        const allNodes = products
            .filter(p => !compositeProductIds.has(p.id)) // Filter bundles if desired
            .map(p => {
                const sold90 = productSales.get(p.id) || 0;
                const velocity = sold90 / DAYS_WINDOW; // Units per day
                const stock = p.stock_quantity || 0;

                // Days until stockout
                const daysLeft = velocity > 0 ? stock / velocity : 9999;

                // Supplier Lead Time
                const supplier = suppliers.find(s => s.id === p.supplier_id);
                const leadTime = supplier?.lead_time_max || supplier?.lead_time_days || 14;

                // When do we need to order?
                const today = new Date();
                const reorderDate = new Date(today);
                reorderDate.setDate(today.getDate() + (daysLeft - leadTime));

                // Status
                let status = 'ok';
                if (velocity > 0) {
                    if (daysLeft <= leadTime) status = 'urgent';
                    else if (daysLeft <= leadTime + 14) status = 'warning';
                }
                if (velocity === 0 && stock <= 5 && stock > 0) status = 'warning'; // Stagnant low stock

                return {
                    ...p,
                    velocity,
                    daysLeft,
                    leadTime,
                    supplierName: supplier?.name || 'Unknown',
                    reorderDate,
                    stock,
                    status,
                    statusScore: status === 'urgent' ? 0 : status === 'warning' ? 1 : 2,
                    children: [],
                    isVariant: !!p.parent_id || p.type === 'variation'
                };
            });

        // Step 2: Build Hierarchy
        const nodeMap = new Map();
        allNodes.forEach(n => nodeMap.set(n.id, n));

        const roots = [];

        allNodes.forEach(node => {
            if (node.isVariant && node.parent_id && nodeMap.has(node.parent_id)) {
                const parent = nodeMap.get(node.parent_id);
                parent.children.push(node);
            } else {
                // It's a root (Simple Product or Variable Parent)
                roots.push(node);
            }
        });

        const VELOCITY_THRESHOLD = 0.02;

        // Step 3: Aggregate Parent Metrics from Children
        roots.forEach(root => {
            if (root.children.length > 0) {
                // Filter low velocity variants first
                root.children = root.children.filter(c => c.velocity >= VELOCITY_THRESHOLD);

                // Parent stats = Sum of children stats
                const totalStock = root.children.reduce((acc, c) => acc + c.stock, 0);
                const totalVelocity = root.children.reduce((acc, c) => acc + c.velocity, 0);

                // Recalculate parent derivations
                root.stock = totalStock;
                root.velocity = totalVelocity;
                root.daysLeft = totalVelocity > 0 ? totalStock / totalVelocity : 9999;

                // Parent Status is worst case of REMAINING children
                if (root.children.length > 0) {
                    const worstChild = root.children.reduce((prev, c) => (c.statusScore < prev.statusScore ? c : prev), { statusScore: 3, status: 'ok' });
                    root.status = worstChild.status;
                    root.statusScore = worstChild.statusScore;

                    const earliestDate = root.children.reduce((prev, c) => (c.reorderDate < prev ? c.reorderDate : prev), new Date(8640000000000000));
                    if (earliestDate.getTime() !== 8640000000000000) {
                        root.reorderDate = earliestDate;
                    }
                } else {
                    root.status = 'ok';
                    root.statusScore = 2;
                }
            }
        });

        return roots
            .filter(r => r.velocity >= VELOCITY_THRESHOLD)
            .sort((a, b) => {
                // Sort by urgency (default)
                return a.statusScore - b.statusScore || a.daysLeft - b.daysLeft;
            });

    }, [products, suppliers, orders, components]);

    // 3. Filtering
    const filtered = useMemo(() => planningData.filter(p => {
        // Filter logic applies to PARENT status for now.
        // If searching, we check parent name. If parent matches, show it.
        // Complex search for children filtering vs parent filtering... simpler to just check parent.
        if (filterStatus !== 'all' && p.status !== filterStatus) return false;
        if (searchTerm && !p.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
        return true;
    }), [planningData, filterStatus, searchTerm]);

    // 4. Sorting Hook
    const { items: sortedItems, requestSort, sortConfig } = useSortableData(filtered);

    // Helper for Header
    const SortableHeader = ({ label, sortKey, align = 'left' }) => {
        const isActive = sortConfig?.key === sortKey;
        return (
            <th
                onClick={() => requestSort(sortKey)}
                style={{ cursor: 'pointer', userSelect: 'none', textAlign: align }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
                    {label}
                    {isActive ? (
                        sortConfig.direction === 'ascending' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                    ) : (
                        <ArrowUpDown size={14} style={{ opacity: 0.3 }} />
                    )}
                </div>
            </th>
        );
    };

    // Render Row Helper
    const RenderRow = ({ item, isChild = false, parentName = '' }) => (
        <React.Fragment key={item.id}>
            <tr
                className={isChild ? 'child-row' : 'parent-row'}
                style={{ background: isChild ? 'rgba(255,255,255,0.02)' : 'transparent' }}
            >
                <td style={{ paddingLeft: isChild ? '48px' : '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {!isChild && item.children.length > 0 && (
                            <button
                                onClick={(e) => toggleExpand(item.id, e)}
                                className="btn-icon-small"
                                style={{ background: 'transparent', border: 'none', padding: 2, cursor: 'pointer', color: 'var(--text-muted)' }}
                            >
                                {expandedIds.has(item.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                        )}
                        {/* Spacer if no children but is parent level to align text */}
                        {!isChild && item.children.length === 0 && <div style={{ width: 16 }}></div>}

                        <div>
                            <div style={{ fontWeight: isChild ? 400 : 600, color: isChild ? 'var(--text-secondary)' : 'var(--text-main)' }}>
                                {isChild ? (item.name.includes(parentName) ? item.name.replace(parentName, '').replace(/^[\s-,\.]+/, '') : item.name) : item.name}
                            </div>
                            {!isChild && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{item.supplierName}</div>}
                        </div>
                    </div>
                </td>
                <td style={{ fontFamily: 'monospace' }}>{item.stock}</td>
                <td>{item.velocity.toFixed(2)} / day</td>
                <td>
                    {item.velocity > 0 ? (
                        <span>{Math.floor(item.daysLeft)} days</span>
                    ) : (
                        <span style={{ color: 'var(--text-muted)' }}>∞</span>
                    )}
                </td>
                <td>
                    {!isChild ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Truck size={14} className="text-muted" /> {item.leadTime} days
                        </div>
                    ) : <span className="text-muted">-</span>}
                </td>
                <td>
                    {item.velocity > 0 ? (
                        <span style={{ color: item.status === 'urgent' ? '#ef4444' : item.status === 'warning' ? '#f59e0b' : 'inherit', fontWeight: item.status !== 'ok' ? 'bold' : 'normal' }}>
                            {item.reorderDate < new Date() ? 'Overdue!' : item.reorderDate.toLocaleDateString()}
                        </span>
                    ) : '-'}
                </td>
                <td>
                    {item.status === 'urgent' && <span className="chip" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}><AlertCircle size={14} /> Reorder Now</span>}
                    {item.status === 'warning' && <span className="chip" style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}>Reorder Soon</span>}
                    {item.status === 'ok' && <span className="chip" style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#10b981' }}><CheckCircle size={14} /> Healthy</span>}
                </td>
            </tr>
            {/* Render Children Recursively (only 1 level deep effectively due to logic, but clean) */}
            {!isChild && expandedIds.has(item.id) && item.children.map(child => (
                <RenderRow key={child.id} item={child} isChild={true} parentName={item.name} />
            ))}
        </React.Fragment>
    );

    return (
        <div className="planning-view">
            <div className="inventory-header" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div className="input-wrapper" style={{ width: '300px' }}>
                        <input
                            className="form-input"
                            style={{ width: '100%' }}
                            placeholder="Search products..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        <Search className="input-icon" size={18} />
                    </div>
                    <select
                        className="form-input"
                        value={filterStatus}
                        onChange={e => setFilterStatus(e.target.value)}
                        style={{ width: '150px' }}
                    >
                        <option value="all">All Items</option>
                        <option value="urgent">Urgent Reorder</option>
                        <option value="warning">Reorder Soon</option>
                        <option value="ok">Healthy Stock</option>
                    </select>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <div className="status-legend" style={{ display: 'flex', gap: '12px', fontSize: '0.85rem', alignItems: 'center' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }}></div> Urgent</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }}></div> Warning</span>
                    </div>
                </div>
            </div>

            <div className="glass-panel inventory-table-container">
                <table className="inventory-table">
                    <thead>
                        <tr>
                            <SortableHeader label="Product" sortKey="name" />
                            <SortableHeader label="Stock" sortKey="stock" />
                            <SortableHeader label="Avg. Daily Sales" sortKey="velocity" />
                            <SortableHeader label="Est. Run Out" sortKey="daysLeft" />
                            <SortableHeader label="Supplier Lead Time" sortKey="leadTime" />
                            <SortableHeader label="Reorder Deadline" sortKey="reorderDate" />
                            <SortableHeader label="Status" sortKey="statusScore" />
                        </tr>
                    </thead>
                    <tbody>
                        {sortedItems.slice(0, 100).map(p => (
                            <RenderRow key={p.id} item={p} />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default InventoryPlanning;
