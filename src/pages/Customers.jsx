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

const SortableHeader = ({ label, sortKey, align = 'left', sortConfig, requestSort }) => {
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


const Customers = () => {
    // Optimization: In a real app with 1M+ rows, we would query Dexie specifically.
    // V1: Load all into memory and filter (fast for < 10k rows).
    const { activeAccount } = useAccount();

    const customers = useLiveQuery(async () => {
        if (!activeAccount) return [];
        return await db.customers.where('account_id').equals(activeAccount.id).toArray();
    }, [activeAccount?.id]);

    const orders = useLiveQuery(async () => {
        if (!activeAccount) return [];
        return await db.orders.where('account_id').equals(activeAccount.id).toArray();
    }, [activeAccount?.id]);
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
        if (!customers || !orders) return [];

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



    return (
        <div className="products-page page-container">
            <div className="products-header">
                <div className="header-content">
                    <div className="customers-icon-wrapper">
                        <Users size={28} />
                    </div>
                    <div className="products-title">
                        <h2>Customers</h2>
                        <p>Manage your customer base</p>
                    </div>
                </div>

                <div className="customers-controls">
                    <div className="search-wrapper">
                        <input
                            type="text"
                            placeholder="Search customers..."
                            className="input-field"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <Search className="input-icon" size={18} />
                    </div>

                    <div className="tools-wrapper">
                        <div className="view-toggle" style={{ background: 'var(--bg-glass-lighter)', borderRadius: '10px', padding: '4px', display: 'flex', gap: '4px', border: '1px solid var(--border-glass)' }}>
                            <button
                                className={`btn-icon ${viewMode === 'list' ? 'active' : ''}`}
                                onClick={() => setViewMode('list')}
                                title="List View"
                                style={{ borderRadius: '8px', width: '36px', height: '36px' }}
                            >
                                <List size={18} />
                            </button>
                            <button
                                className={`btn-icon ${viewMode === 'map' ? 'active' : ''}`}
                                onClick={() => setViewMode('map')}
                                title="Map View"
                                style={{ borderRadius: '8px', width: '36px', height: '36px' }}
                            >
                                <MapIcon size={18} />
                            </button>
                        </div>

                        <button
                            className={`btn-filter ${showFilters ? 'btn-primary' : ''}`}
                            onClick={() => setShowFilters(!showFilters)}
                        >
                            <Filter size={18} /> <span>Segment</span>
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
                <div className="products-table-container">
                    <table className="products-table">
                        <thead>
                            <tr>
                                <SortableHeader label="Customer" sortKey="first_name" sortConfig={sortConfig} requestSort={requestSort} />
                                <SortableHeader label="Total Spent" sortKey="total_spent" sortConfig={sortConfig} requestSort={requestSort} />
                                <SortableHeader label="Orders" sortKey="orders_count" sortConfig={sortConfig} requestSort={requestSort} />
                                <SortableHeader label="Role" sortKey="role" sortConfig={sortConfig} requestSort={requestSort} />
                                <SortableHeader label="Tags" sortKey={null} sortConfig={sortConfig} requestSort={requestSort} />
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
                                            <span className="mobile-label">Total Spent</span>
                                            <span style={{ fontWeight: 600 }}>{formatCurrency(customer.total_spent)}</span>
                                        </td>
                                        <td data-label="Orders">
                                            <span className="mobile-label">Orders</span>
                                            {customer.orders_count}
                                        </td>
                                        <td data-label="Role">
                                            <span className="mobile-label">Role</span>
                                            <span className="role-badge">{customer.role}</span>
                                        </td>
                                        <td data-label="Tags">
                                            <span className="mobile-label">Tags</span>
                                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                                                {(customer.local_tags || []).map((tag, idx) => (
                                                    <span key={idx} className="badge badge-info status-badge" style={{ fontSize: '0.75rem' }}>
                                                        {tag}
                                                    </span>
                                                ))}
                                                <button
                                                    className="btn-icon"
                                                    style={{ width: '24px', height: '24px', padding: 0 }}
                                                    onClick={() => handleAddTag(customer.id, customer.local_tags)}
                                                    title="Add Tag"
                                                >
                                                    <Plus size={14} />
                                                </button>
                                            </div>
                                        </td>
                                        <td data-label="Actions">
                                            <button
                                                className="table-action-btn"
                                                onClick={() => navigate(`/customers/${customer.id}`)}
                                            >
                                                View Profile
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="6" style={{ textAlign: 'center', padding: '4rem' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', color: 'var(--text-muted)' }}>
                                            <div style={{ background: 'var(--bg-glass-lighter)', padding: '2rem', borderRadius: '50%' }}>
                                                <Users size={48} style={{ opacity: 0.5 }} />
                                            </div>
                                            <p style={{ fontSize: '1.1rem' }}>No customers found matching your segment.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    <div style={{ padding: '1rem', borderTop: '1px solid var(--border-glass)' }}>
                        <Pagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            itemsPerPage={itemsPerPage}
                            onPageChange={setCurrentPage}
                            onItemsPerPageChange={setItemsPerPage}
                            totalItems={totalItems}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default Customers;
