import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    ShoppingBag,
    Users,
    BarChart2,
    Settings,
    Package,
    Ticket,
    Shield,
    Zap,
    TrendingUp,
    FileText,
    ChevronDown,
    ChevronRight,
    ChevronLeft,
    Magnet,
    MousePointer2,
    ShoppingCart,
    Truck,
    Layers,
    Contact,
    PanelLeft,
    Printer,
    Star,
    Globe,
    MessageCircle,
    Book,
    X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import './Sidebar.css';

const Sidebar = ({ collapsed, toggleCollapsed, mobileOpen, closeMobile }) => {
    const location = useLocation();
    const auth = useAuth();
    const { activeAccount } = useAccount();
    const hasPermission = auth?.hasPermission || (() => false);
    const [expandedItems, setExpandedItems] = useState({});

    // Auto-expand groups based on current path
    useEffect(() => {
        if (collapsed) return;

        // Find which item should be active
        let activeLabel = null;
        visibleNavGroups.forEach(group => {
            group.items.forEach(item => {
                if (item.children && location.pathname.startsWith(item.path)) {
                    activeLabel = item.label;
                }
            });
        });

        if (activeLabel) {
            setExpandedItems({ [activeLabel]: true });
        }
    }, [location.pathname, collapsed]);

    const toggleSubmenu = (label) => {
        if (collapsed && !mobileOpen) {
            toggleCollapsed();
            setTimeout(() => {
                setExpandedItems({ [label]: true });
            }, 100);
            return;
        }

        setExpandedItems(prev => {
            // If clicking the one that is already open, toggle it closed
            if (prev[label]) {
                return {};
            }
            // Otherwise, open this one and close others (Accordion style)
            return { [label]: true };
        });
    };

    // Navigation Groups
    const navGroups = [
        {
            title: null,
            items: [
                { icon: LayoutDashboard, label: 'Overview', path: '/' },
            ]
        },
        {
            title: 'Commerce',
            items: [
                {
                    icon: ShoppingBag,
                    label: 'Sales',
                    path: '/sales-group',
                    permission: 'view_orders',
                    children: [
                        { label: 'Orders', path: '/orders' },
                        { label: 'Live Carts', path: '/carts' },
                        { label: 'Invoice Designer', path: '/invoices/builder' },
                    ]
                },
                {
                    icon: Package,
                    label: 'Inventory',
                    path: '/inventory-group',
                    permission: 'view_products',
                    children: [
                        { label: 'Products', path: '/products' },
                        { label: 'Stock & BOM', path: '/inventory', feature: 'bom' },
                        { label: 'Purchase Orders', path: '/purchase-orders' },
                        { label: 'Suppliers', path: '/suppliers' },
                    ]
                },
                {
                    icon: Users,
                    label: 'Engagement',
                    path: '/engagement-group',
                    permission: 'view_customers',
                    children: [
                        { label: 'Customers', path: '/customers' },
                        { label: 'Inbox', path: '/inbox' },
                        { label: 'Reviews', path: '/reviews' },
                        { label: 'Automations', path: '/automations' },
                        { label: 'Coupons', path: '/coupons' },
                    ]
                },
            ]
        },
        {
            title: 'Analytics',
            items: [
                { icon: BarChart2, label: 'Performance', path: '/analytics', permission: 'view_analytics' },
                {
                    icon: Magnet,
                    label: 'Acquisition',
                    path: '/visitors',
                    permission: 'view_analytics',
                    children: [
                        { label: 'Overview', path: '/visitors?view=overview' },
                        { label: 'Real-time Log', path: '/visitors', exact: true },
                        { label: 'Channels', path: '/visitors?view=channels' },
                        { label: 'Campaigns', path: '/visitors?view=campaigns' },
                        { label: 'URL Builder', path: '/visitors?view=url_builder' },
                    ]
                },
                {
                    icon: MousePointer2,
                    label: 'Behaviour',
                    path: '/analytics/behaviour',
                    permission: 'view_analytics',
                    children: [
                        { label: 'Pages', path: '/analytics/behaviour?view=pages', exact: true },
                        { label: 'Entry Pages', path: '/analytics/behaviour?view=entry_pages' },
                        { label: 'Exit Pages', path: '/analytics/behaviour?view=exit_pages' },
                        { label: 'Page Titles', path: '/analytics/behaviour?view=titles' },
                        { label: 'Site Search', path: '/analytics/behaviour?view=site_search' },
                    ]
                },
                {
                    icon: Package,
                    label: 'Product Reports',
                    path: '/analytics/products',
                    permission: 'view_analytics',
                    children: [
                        { label: 'Overview', path: '/analytics/products', exact: true },
                        { label: 'Products', path: '/analytics/products?view=products' },
                        { label: 'Top Sellers', path: '/analytics/products?view=top_sellers' },
                        { label: 'Bought Together', path: '/analytics/products?view=bought_together' },
                        { label: 'Stock Velocity', path: '/analytics/products?view=velocity' },
                    ]
                },
                { icon: TrendingUp, label: 'Forecasting', path: '/analytics/forecasting', permission: 'view_analytics' },
                { icon: FileText, label: 'Digests', path: '/analytics/reports', permission: 'view_analytics' },
            ]
        },
        {
            title: 'System',
            items: [
                { icon: Shield, label: 'Team', path: '/users', permission: 'view_users' },
                { icon: Shield, label: 'Admin Panel', path: '/admin', permission: 'admin' },
                { icon: Settings, label: 'Settings', path: '/settings', permission: 'view_settings' },
                { icon: Book, label: 'Help Center', path: '/help' },
            ]
        }
    ];

    // Filter Items based on permissions and features (including children)
    const visibleNavGroups = navGroups.map(group => {
        const visibleItems = group.items.map(item => {
            // Check Parent Permission
            if (item.permission && !hasPermission(item.permission)) return null;
            if (item.feature && !activeAccount?.features?.[item.feature]) return null;

            // Filter Children if present
            if (item.children) {
                const visibleChildren = item.children.filter(child => {
                    if (child.permission && !hasPermission(child.permission)) return false;
                    if (child.feature && !activeAccount?.features?.[child.feature]) return false;
                    return true;
                });
                if (visibleChildren.length === 0 && !item.path) return null; // Hide parent if no children (and no direct path)
                return { ...item, children: visibleChildren };
            }

            return item;
        }).filter(Boolean); // Remove nulls

        return { ...group, items: visibleItems };
    }).filter(group => group.items.length > 0);

    return (
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
            <div className="logo-container">
                <div className="logo-icon">O</div>
                <span className="logo-text">OverSeek</span>
                {mobileOpen && (
                    <button
                        onClick={closeMobile}
                        style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'white', opacity: 0.7 }}
                    >
                        <X size={20} />
                    </button>
                )}
            </div>

            <nav className="nav-menu">
                {visibleNavGroups.map((group, groupIdx) => (
                    <div key={groupIdx} className="nav-group">
                        {group.title && <div className="nav-group-title">{group.title}</div>}
                        {group.items.map((item) => {
                            if (item.children) {
                                const isExpanded = expandedItems[item.label] && (!collapsed || mobileOpen);
                                const isActiveParent = location.pathname.startsWith(item.path);
                                return (
                                    <div key={item.label} className="nav-item-container">
                                        <div
                                            className={`nav-item ${isActiveParent ? 'active' : ''} ${isExpanded ? 'expanded' : ''}`}
                                            onClick={() => toggleSubmenu(item.label)}
                                            style={{ cursor: 'pointer', justifyContent: (collapsed && !mobileOpen) ? 'center' : 'space-between' }}
                                            title={(collapsed && !mobileOpen) ? item.label : ''}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <item.icon />
                                                <span>{item.label}</span>
                                            </div>
                                            {(!collapsed || mobileOpen) && (isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
                                        </div>
                                        {isExpanded && (!collapsed || mobileOpen) && (
                                            <div className="submenu">
                                                {item.children.map(child => (
                                                    <NavLink
                                                        key={child.label}
                                                        to={child.path}
                                                        className={({ isActive }) => {
                                                            const currentUrl = location.pathname + location.search;
                                                            const isExactMatch = child.exact
                                                                ? (location.pathname === item.path && !location.search)
                                                                : currentUrl === child.path;
                                                            return `submenu-item ${isExactMatch ? 'active' : ''}`;
                                                        }}
                                                        end={child.exact}
                                                    >
                                                        {child.label}
                                                    </NavLink>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            }

                            return (
                                <NavLink
                                    key={item.path}
                                    to={item.path}
                                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                                    end={item.path === '/' || item.path === '/analytics'}
                                    title={(collapsed && !mobileOpen) ? item.label : ''}
                                >
                                    <item.icon />
                                    <span>{item.label}</span>
                                </NavLink>
                            );
                        })}
                    </div>
                ))}
            </nav>

            {!mobileOpen && (
                <button
                    onClick={toggleCollapsed}
                    className="collapse-btn"
                    title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                >
                    {collapsed ? <ChevronRight size={20} /> : <PanelLeft size={20} />}
                </button>
            )}
        </aside>
    );
};

export default Sidebar;
