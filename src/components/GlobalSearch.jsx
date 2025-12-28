import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Package, ShoppingBag, Users, ChevronRight, X } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import './GlobalSearch.css';

const GlobalSearch = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const containerRef = useRef(null);
    const inputRef = useRef(null);
    const [mobileOpen, setMobileOpen] = useState(false);

    // Debounce query to avoid heavy lifting on every keystroke
    const [debouncedQuery, setDebouncedQuery] = useState('');
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(timer);
    }, [query]);

    // Perform Search
    const searchResults = useLiveQuery(async () => {
        if (!debouncedQuery || debouncedQuery.length < 2) return null;

        const term = debouncedQuery.toLowerCase();

        // 1. Search Products (Indexed by name)
        const products = await db.products
            .where('name').startsWithIgnoreCase(term)
            .or('sku').startsWithIgnoreCase(term)
            .limit(5)
            .toArray();

        // 2. Search Customers (Indexed by first_name, last_name, email)
        const customers = await db.customers
            .where('first_name').startsWithIgnoreCase(term)
            .or('last_name').startsWithIgnoreCase(term)
            .or('email').startsWithIgnoreCase(term)
            .limit(5)
            .toArray();

        // 3. Search Orders (Indexed by id)
        let orders = [];
        if (!isNaN(term)) {
            const allOrders = await db.orders.orderBy('date_created').reverse().limit(200).toArray();
            orders = allOrders.filter(o => o.id.toString().includes(term));
        }

        return {
            products,
            customers,
            orders: orders.slice(0, 5)
        };
    }, [debouncedQuery]);

    // Flatten results for keyboard navigation
    const flatResults = useMemo(() => {
        if (!searchResults) return [];
        const { products = [], customers = [], orders = [] } = searchResults;
        return [
            ...products.map(p => ({ ...p, type: 'product' })),
            ...customers.map(c => ({ ...c, type: 'customer' })),
            ...orders.map(o => ({ ...o, type: 'order' }))
        ];
    }, [searchResults]);

    // Close mobile search on navigate
    useEffect(() => {
        setMobileOpen(false);
    }, [location.pathname]);

    // Keyboard Shortcut (Ctrl+K / Cmd+K)
    useEffect(() => {
        const handleGlobalKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen(true);
                if (window.innerWidth <= 768) {
                    setMobileOpen(true);
                } else {
                    inputRef.current?.focus();
                }
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (item) => {
        setIsOpen(false);
        setQuery('');
        if (item.type === 'product') navigate(`/products/${item.id}`);
        if (item.type === 'customer') navigate(`/customers/${item.id}`);
        if (item.type === 'order') navigate(`/orders/${item.id}`);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev < flatResults.length - 1 ? prev + 1 : prev));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && flatResults[selectedIndex]) {
                handleSelect(flatResults[selectedIndex]);
            } else if (query) {
                // Default fallback
                setIsOpen(false);
                navigate(`/products?search=${encodeURIComponent(query)}`);
            }
        } else if (e.key === 'Escape') {
            setIsOpen(false);
            setMobileOpen(false);
            e.currentTarget.blur();
        }
    };

    const hasResults = flatResults.length > 0;

    return (
        <>
            {/* Mobile Trigger Button */}
            <button
                className="mobile-search-trigger"
                onClick={() => setMobileOpen(true)}
                title="Search"
            >
                <Search size={20} />
            </button>

            {/* Main Search Container */}
            <div className={`global-search ${mobileOpen ? 'mobile-active' : ''}`} ref={containerRef}>
                {/* Mobile Overlay Header/Close */}
                {mobileOpen && (
                    <button
                        className="mobile-close-btn"
                        onClick={() => setMobileOpen(false)}
                    >
                        <X size={24} />
                    </button>
                )}

                <div className="search-input-wrapper">
                    <Search size={18} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search (Ctrl+K)"
                        className="form-input search-input"
                        value={query}
                        onChange={e => {
                            setQuery(e.target.value);
                            setIsOpen(true);
                            setSelectedIndex(0);
                        }}
                        onFocus={() => setIsOpen(true)}
                        onKeyDown={handleKeyDown}
                        ref={(el) => {
                            inputRef.current = el;
                            if (mobileOpen && el) el.focus();
                        }}
                    />
                    {query && (
                        <button className="clear-btn" onClick={() => { setQuery(''); setIsOpen(false); }}>
                            <X size={14} />
                        </button>
                    )}
                </div>

                {isOpen && query.length >= 2 && (
                    <div className="search-dropdown glass-panel">
                        {!hasResults && (
                            <div className="no-results">
                                <span className="text-muted">No results found for "{query}"</span>
                            </div>
                        )}

                        {searchResults?.products?.length > 0 && (
                            <div className="search-section">
                                <h4 className="section-title">Products</h4>
                                {searchResults.products.map((p, idx) => (
                                    <div
                                        key={`p-${p.id}`}
                                        className={`search-result-item ${flatResults[idx] === p && selectedIndex === idx ? 'selected' : ''}`}
                                        onClick={() => handleSelect({ ...p, type: 'product' })}
                                        onMouseEnter={() => setSelectedIndex(flatResults.indexOf({ ...p, type: 'product' }))}
                                    >
                                        <Package size={16} className="text-muted" />
                                        <div className="result-info">
                                            <span className="result-main">{p.name}</span>
                                            <span className="result-sub">SKU: {p.sku || '-'} • ${p.price}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {searchResults?.customers?.length > 0 && (
                            <div className="search-section">
                                <h4 className="section-title">Customers</h4>
                                {searchResults.customers.map((c, idx) => (
                                    <div
                                        key={`c-${c.id}`}
                                        className={`search-result-item ${flatResults.find(i => i.id === c.id && i.type === 'customer') && selectedIndex === flatResults.findIndex(i => i.id === c.id && i.type === 'customer') ? 'selected' : ''}`}
                                        onClick={() => handleSelect({ ...c, type: 'customer' })}
                                    >
                                        <Users size={16} className="text-muted" />
                                        <div className="result-info">
                                            <span className="result-main">{c.first_name} {c.last_name}</span>
                                            <span className="result-sub">{c.email}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {searchResults?.orders?.length > 0 && (
                            <div className="search-section">
                                <h4 className="section-title">Orders</h4>
                                {searchResults.orders.map((o, idx) => (
                                    <div
                                        key={`o-${o.id}`}
                                        className={`search-result-item ${flatResults.find(i => i.id === o.id && i.type === 'order') && selectedIndex === flatResults.findIndex(i => i.id === o.id && i.type === 'order') ? 'selected' : ''}`}
                                        onClick={() => handleSelect({ ...o, type: 'order' })}
                                    >
                                        <ShoppingBag size={16} className="text-muted" />
                                        <div className="result-info">
                                            <span className="result-main">Order #{o.id}</span>
                                            <span className="result-sub">{new Date(o.date_created).toLocaleDateString()} • {o.status}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="search-footer">
                            <span>Press ↵ to view all results</span>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default GlobalSearch;
