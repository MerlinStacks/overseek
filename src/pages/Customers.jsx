import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Users, Search, Mail, Filter, Tag, Plus, ArrowUpDown, ArrowUp, ArrowDown, Map as MapIcon, List } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import FilterBuilder from '../components/FilterBuilder';
import Pagination from '../components/Pagination';
import { useSortableData } from '../hooks/useSortableData';
import CustomerMap from '../components/CustomerMap';
import './Customers.css';

const customerFields = [
    { label: 'Total Spent', key: 'total_spent', type: 'number' },
    { label: 'Order Count', key: 'orders_count', type: 'number' },
    { label: 'Last Order Date', key: 'last_order_date', type: 'date' },
    { label: 'City', key: 'billing.city', type: 'string' },
    { label: 'State', key: 'billing.state', type: 'string' },
    { label: 'Country', key: 'billing.country', type: 'string' },
    { label: 'Email', key: 'email', type: 'string' },
    { label: 'First Name', key: 'first_name', type: 'string' },
    { label: 'Last Name', key: 'last_name', type: 'string' },
    { label: 'Role', key: 'role', type: 'string' },
    { label: 'Tags', key: 'local_tags', type: 'string' },
];

import { useAccount } from '../context/AccountContext';

const Customers = () => {
    // Optimization: In a real app with 1M+ rows, we would query Dexie specifically.
    // V1: Load all into memory and filter (fast for < 10k rows).
    const { activeAccount } = useAccount();

    const customers = useLiveQuery(async () => {
        if (!activeAccount) return [];
        return await db.customers.where('account_id').equals(activeAccount.id).toArray();
    }, [activeAccount?.id]) || [];

    const orders = useLiveQuery(async () => {
        if (!activeAccount) return [];
        return await db.orders.where('account_id').equals(activeAccount.id).toArray();
    }, [activeAccount?.id]) || [];
    const [searchTerm, setSearchTerm] = useState('');
    const [activeFilters, setActiveFilters] = useState([]);
    const [showFilters, setShowFilters] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(15);
    const [viewMode, setViewMode] = useState('list');
    const navigate = useNavigate();

    // Reset page on search/filter change
    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, activeFilters]);

    // Enrich customers with aggregate data (Total Spent, Order Count)
    const enrichedCustomers = useMemo(() => {
        if (!customers.length) return [];

        // Map customer ID/email to stats
        const stats = {};
        orders.forEach(o => {
            const cid = o.customer_id;
            // Fallback to email if guest checkout
            const email = o.billing?.email;
            const key = cid > 0 ? cid : email;

            if (!key) return;

            if (!stats[key]) stats[key] = { spent: 0, count: 0, last_order: null };

            stats[key].spent += parseFloat(o.total || 0);
            stats[key].count += 1;

            const date = new Date(o.date_created);
            if (!stats[key].last_order || date > stats[key].last_order) {
                stats[key].last_order = date;
            }
        });

        return customers.map(c => {
            // Match aggregation
            const key = c.id;
            const s = stats[key] || { spent: 0, count: 0, last_order: null };
            return {
                ...c,
                total_spent: s.spent,
                orders_count: s.count,
                last_order_date: s.last_order
            };
        });
    }, [customers, orders]);

    // Filtering Logic
    const filteredCustomers = useMemo(() => {
        return enrichedCustomers.filter(c => {
            // 1. Text Search (Legacy)
            const matchesSearch = !searchTerm || (
                (c.first_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (c.last_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (c.email || '').toLowerCase().includes(searchTerm.toLowerCase())
            );
            if (!matchesSearch) return false;

            // 2. Advanced Segment Filters
            if (activeFilters.length === 0) return true;

            return activeFilters.every(filter => {
                const { field, operator, value } = filter;
                let itemValue = field.includes('.') ? field.split('.').reduce((obj, key) => obj?.[key], c) : c[field];

                // Conversions
                const numValue = parseFloat(value);
                const dateValue = new Date(value);

                if (itemValue === undefined || itemValue === null) return false;

                switch (operator) {
                    case 'eq': return parseFloat(itemValue) === numValue;
                    case 'gt': return parseFloat(itemValue) > numValue;
                    case 'lt': return parseFloat(itemValue) < numValue;
                    case 'contains':
                        if (Array.isArray(itemValue)) {
                            return itemValue.some(t => String(t).toLowerCase().includes(String(value).toLowerCase()));
                        }
                        return String(itemValue).toLowerCase().includes(String(value).toLowerCase());
                    case 'is': return String(itemValue).toLowerCase() === String(value).toLowerCase();
                    case 'after': return new Date(itemValue) > dateValue;
                    case 'before': return new Date(itemValue) < dateValue;
                    default: return true;
                }
            });
        });
    }, [enrichedCustomers, searchTerm, activeFilters]);

    // Sorting Hook
    const { items: sortedCustomers, requestSort, sortConfig } = useSortableData(filteredCustomers);

    // Pagination Logic
    const totalItems = sortedCustomers.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const paginatedCustomers = sortedCustomers.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const getInitials = (first, last) => {
        return `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();
    };

    const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

    const handleAddTag = async (customerId, currentTags) => {
        const tag = window.prompt("Enter new tag:");
        if (tag) {
            const newTags = currentTags ? [...currentTags, tag] : [tag];
            await db.customers.update(customerId, { local_tags: newTags });
        }
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
                            sortConfig.direction === 'ascending' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                        ) : (
                            <ArrowUpDown size={14} style={{ opacity: 0.3 }} />
                        )
                    )}
                </div>
            </th>
        );
    };

    return (
        <div className="products-page">
            <div className="products-header">
                <div className="header-content">
                    <div className="customers-icon-wrapper">
                        <Users size={32} />
                    </div>
                    <div className="products-title">
                        <h2>Customers</h2>
                        <p>Manage your customer base.</p>
                    </div>
                </div>

                <div className="customers-controls">
                    <div className="input-wrapper search-wrapper">
                        <input
                            type="text"
                            placeholder="Search customers..."
                            className="form-input"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <Search className="input-icon" size={18} />
                    </div>

                    <div className="tools-wrapper">
                        <div className="view-toggle" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px', display: 'flex', gap: '4px' }}>
                            <button
                                className={`btn-icon ${viewMode === 'list' ? 'active' : ''}`}
                                style={{ background: viewMode === 'list' ? 'rgba(255,255,255,0.1)' : 'transparent', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px' }}
                                onClick={() => setViewMode('list')}
                                title="List View"
                            >
                                <List size={18} />
                            </button>
                            <button
                                className={`btn-icon ${viewMode === 'map' ? 'active' : ''}`}
                                style={{ background: viewMode === 'map' ? 'rgba(255,255,255,0.1)' : 'transparent', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px' }}
                                onClick={() => setViewMode('map')}
                                title="Map View"
                            >
                                <MapIcon size={18} />
                            </button>
                        </div>

                        <button
                            className={`btn ${showFilters ? 'btn-primary' : ''} btn-filter`}
                            style={{ background: showFilters ? '' : 'rgba(255,255,255,0.05)' }}
                            onClick={() => setShowFilters(!showFilters)}
                        >
                            <Filter size={18} /> <span className="btn-text">Segment</span>
                        </button>
                    </div>
                </div>
            </div>

            {showFilters && (
                <FilterBuilder
                    onApply={setActiveFilters}
                    context="customers"
                    fields={customerFields}
                />
            )}

            {viewMode === 'map' ? (
                <CustomerMap customers={filteredCustomers} />
            ) : (
                <div className="glass-panel products-table-container">
                    <table className="products-table">
                        <thead>
                            <tr>
                                <SortableHeader label="Customer" sortKey="first_name" />
                                <SortableHeader label="Total Spent" sortKey="total_spent" />
                                <SortableHeader label="Orders" sortKey="orders_count" />
                                <SortableHeader label="Role" sortKey="role" />
                                <SortableHeader label="Tags" sortKey={null} />
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedCustomers.length > 0 ? (
                                paginatedCustomers.map(customer => (
                                    <tr key={customer.id}>
                                        <td data-label="Customer">
                                            <div className="avatar-cell">
                                                <div className="customer-avatar">
                                                    {getInitials(customer.first_name, customer.last_name)}
                                                </div>
                                                <div className="customer-info">
                                                    <span className="customer-name">{customer.first_name} {customer.last_name}</span>
                                                    <span className="customer-email">{customer.email}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td data-label="Total Spent">
                                            <span className="mobile-label">Total Spent:</span>
                                            {formatCurrency(customer.total_spent)}
                                        </td>
                                        <td data-label="Orders">
                                            <span className="mobile-label">Orders:</span>
                                            {customer.orders_count}
                                        </td>
                                        <td data-label="Role">
                                            <span className="mobile-label">Role:</span>
                                            <span className="role-badge">{customer.role}</span>
                                        </td>
                                        <td data-label="Tags">
                                            <span className="mobile-label">Tags:</span>
                                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
                                                {(customer.local_tags || []).map((tag, idx) => (
                                                    <span key={idx} className="status-badge" style={{ fontSize: '0.75rem', padding: '2px 6px', background: 'rgba(255,255,255,0.1)' }}>
                                                        {tag}
                                                    </span>
                                                ))}
                                                <button
                                                    className="btn-icon-sm"
                                                    style={{ padding: '2px', opacity: 0.5, cursor: 'pointer', border: 'none', background: 'transparent', color: 'inherit' }}
                                                    onClick={() => handleAddTag(customer.id, customer.local_tags)}
                                                    title="Add Tag"
                                                >
                                                    <Plus size={14} />
                                                </button>
                                            </div>
                                        </td>
                                        <td data-label="Actions">
                                            <button
                                                className="btn"
                                                style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.05)' }}
                                                onClick={() => navigate(`/customers/${customer.id}`)}
                                            >
                                                View
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="6" style={{ textAlign: 'center', padding: '3rem' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', color: 'var(--text-muted)' }}>
                                            <Users size={48} style={{ opacity: 0.5 }} />
                                            <p>No customers found matching your segment.</p>
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
            )}
        </div>
    );
};

export default Customers;
