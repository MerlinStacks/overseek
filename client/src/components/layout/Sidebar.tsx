import { useState, useEffect, useMemo, useRef, memo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { usePrefetch } from '../../hooks/usePrefetch';
import { usePermissions } from '../../hooks/usePermissions';
import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    Users,
    BarChart3,
    Settings,
    Megaphone,
    MessageSquare,
    Store,
    PieChart,
    TrendingUp,
    PenTool,
    ChevronDown,
    Star,
    LineChart,
    DollarSign,
    GitBranch,
    X,
    BookOpen,
    Zap,
    HelpCircle,
    UsersRound,
    Filter,
    TrendingDown,
    RefreshCw,
    Search,
    Bot,
    FileText,
    Mail,
    Rss,
    Truck,
    ClipboardList,
    Ban
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { AccountSwitcher } from './AccountSwitcher';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { SidebarSyncStatus } from './SidebarSyncStatus';
import { useAccountFeature } from '../../hooks/useAccountFeature';

interface SidebarProps {
    /** Mobile drawer mode - whether sidebar is open */
    isOpen?: boolean;
    /** Callback to close mobile drawer */
    onClose?: () => void;
    /** Whether we're in mobile mode (drawer behavior) */
    isMobile?: boolean;
}

const SIDEBAR_COLLAPSED_KEY = 'overseek:sidebar-collapsed';
const SIDEBAR_IDLE_COLLAPSE_DELAY_MS = 1200;

const navItems = [
    { type: 'link', icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
    { type: 'link', icon: MessageSquare, label: 'Inbox', path: '/inbox' },
    {
        type: 'group',
        label: 'Commerce',
        icon: Store,
        children: [
            { icon: ShoppingCart, label: 'Orders', path: '/orders' },
            { icon: Package, label: 'Inventory', path: '/inventory' },
            { icon: RefreshCw, label: 'BOM Sync', path: '/inventory/bom-sync' },
            { icon: TrendingDown, label: 'Forecasts', path: '/inventory/forecasts' },
            { icon: PenTool, label: 'Invoice Designer', path: '/invoices/design' },
        ]
    },
    {
        type: 'group',
        label: 'Shipping',
        icon: Truck,
        children: [
            { icon: Truck, label: 'Hub', path: '/shipping' },
            { icon: Package, label: 'Packages', path: '/shipping/packages' },
            { icon: ClipboardList, label: 'Item Overwrites', path: '/shipping/item-overwrites' },
            { icon: FileText, label: 'Past Labels / Invoices', path: '/shipping/labels' },
            { icon: ClipboardList, label: 'Operations', path: '/shipping/operations' },
            { icon: Settings, label: 'Settings', path: '/shipping/settings' },
        ]
    },
    {
        type: 'group',
        label: 'Emails',
        icon: Mail,
        children: [
            { icon: BarChart3, label: 'Email Hub', path: '/emails' },
            { icon: Users, label: 'Customers', path: '/customers' },
            { icon: Filter, label: 'Segments', path: '/customers/segments' },
            { icon: Zap, label: 'Flows', path: '/flows' },
            { icon: Megaphone, label: 'Broadcasts', path: '/broadcasts' },
            { icon: Users, label: 'Email Lists', path: '/emails/lists' },
            { icon: Settings, label: 'Settings', path: '/emails/settings' },
            { icon: Mail, label: 'Logs', path: '/emails/logs' },
            { icon: Ban, label: 'Blocked Contacts', path: '/emails/blocked-contacts' },
        ]
    },
    {
        type: 'group',
        label: 'Analytics',
        icon: PieChart,
        children: [
            { icon: LineChart, label: 'Overview', path: '/analytics' },
            { icon: DollarSign, label: 'Revenue', path: '/analytics/revenue' },
            { icon: GitBranch, label: 'Attribution & Cohorts', path: '/analytics/attribution' },
            { icon: BarChart3, label: 'Acquisition', path: '/live' },
            { icon: BarChart3, label: 'Reports', path: '/reports' },
            { icon: Bot, label: 'Bot Shield', path: '/crawlers' },
        ]
    },
    {
        type: 'group',
        label: 'Growth',
        icon: TrendingUp,
        children: [
            { icon: Megaphone, label: 'Paid Ads', path: '/ads' },
            { icon: Star, label: 'Reviews', path: '/reviews' },
            { icon: Search, label: 'SEO Keywords', path: '/seo' },
            { icon: FileText, label: 'SEO Content', path: '/seo/content' },
            { icon: Rss, label: 'Feeds', path: '/feeds' },
            { icon: Bot, label: 'AI Manager', path: '/ai-manager' },
        ]
    },
    { type: 'link', icon: BookOpen, label: 'Policies & SOP', path: '/policies' },
    { type: 'link', icon: UsersRound, label: 'Team', path: '/team' },
    { type: 'link', icon: HelpCircle, label: 'Help Center', path: '/help' },
];

/** Why memo: Sidebar subscribes to many contexts; wrapping in memo ensures
 *  it only re-renders when its own props (`isOpen`, `onClose`, `isMobile`) change
 *  rather than on every parent re-render from DashboardLayout. */
export const Sidebar = memo(function Sidebar({ isOpen = true, onClose, isMobile = false }: SidebarProps) {
    const [collapsed, setCollapsed] = useState(() => {
        if (typeof window === 'undefined') return true;
        const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
        return stored === null ? true : stored === 'true';
    });
    const [isInteracting, setIsInteracting] = useState(false);
    const collapseDelayTimeoutRef = useRef<number | null>(null);
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const { token } = useAuth();
    const { socket } = useSocket();
    const { hasPermission } = usePermissions(); // Permission hook
    const isEmailEnabled = useAccountFeature('EMAIL');
    const isBotShieldEnabled = useAccountFeature('BOT_SHIELD');
    const isAiManagerEnabled = useAccountFeature('AI_MANAGER');
    const isFeedsEnabled = useAccountFeature('FEED_EXPORTS');
    const isShippingEnabled = useAccountFeature('SHIPPING_HUB');
    const { prefetch } = usePrefetch(); // Route prefetching for faster navigation
    const location = useLocation();

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    }, [collapsed]);

    useEffect(() => {
        return () => {
            if (collapseDelayTimeoutRef.current !== null) {
                window.clearTimeout(collapseDelayTimeoutRef.current);
            }
        };
    }, []);

    const isCollapsedView = !isMobile && collapsed && !isInteracting;

    const clearCollapseDelay = () => {
        if (collapseDelayTimeoutRef.current !== null) {
            window.clearTimeout(collapseDelayTimeoutRef.current);
            collapseDelayTimeoutRef.current = null;
        }
    };

    const startCollapseDelay = () => {
        clearCollapseDelay();
        collapseDelayTimeoutRef.current = window.setTimeout(() => {
            setIsInteracting(false);
            collapseDelayTimeoutRef.current = null;
        }, SIDEBAR_IDLE_COLLAPSE_DELAY_MS);
    };

    const handleSidebarEnter = () => {
        clearCollapseDelay();
        setIsInteracting(true);
    };

    /** Why useMemo: Permission filtering was running on every render (every route change).
     *  Permissions and nav items rarely change — only when user role or account changes. */
    const filteredNavItems = useMemo(() => {
        return navItems.filter(item => {
            if (item.label === 'Commerce') {
                const hasChild = item.children?.some(child => {
                    if (child.path === '/orders') return hasPermission('view_orders');
                    if (child.path === '/inventory' || child.path === '/inventory/forecasts' || child.path === '/inventory/bom-sync') return hasPermission('view_products');
                    return true;
                });
                return hasChild;
            }
            if (item.label === 'Emails') {
                if (!isEmailEnabled) return false;
                const hasChild = item.children?.some(child => {
                    if (child.path === '/customers' || child.path === '/customers/segments') return hasPermission('view_orders');
                    if (child.path === '/emails' || child.path === '/flows' || child.path === '/broadcasts' || child.path === '/emails/lists' || child.path === '/emails/settings' || child.path === '/emails/logs' || child.path === '/emails/blocked-contacts') return hasPermission('view_marketing');
                    return true;
                });
                return hasChild;
            }
            if (item.label === 'Shipping') return isShippingEnabled && hasPermission('view_shipping');
            if (item.label === 'Analytics') return hasPermission('view_finance');
            if (item.label === 'Growth') return hasPermission('view_marketing');
            if (item.label === 'Team') return hasPermission('view_orders');
            return true;
        }).map(item => {
            if (item.children) {
                return {
                    ...item,
                    children: item.children.filter(child => {
                        if (child.path === '/crawlers') return isBotShieldEnabled;
                        if (child.path === '/ai-manager') return isAiManagerEnabled && hasPermission('view_marketing');
                        if (child.path === '/feeds') return isFeedsEnabled && hasPermission('view_marketing');
                        if (child.path?.startsWith('/shipping')) return isShippingEnabled && hasPermission('view_shipping');
                        if (child.path === '/orders') return hasPermission('view_orders');
                        if (child.path === '/inventory' || child.path === '/inventory/forecasts' || child.path === '/inventory/bom-sync') return hasPermission('view_products');
                        if (child.path === '/customers' || child.path === '/customers/segments') return hasPermission('view_orders');
                        if (child.path === '/emails' || child.path === '/flows' || child.path === '/broadcasts' || child.path === '/emails/lists' || child.path === '/emails/settings' || child.path === '/emails/logs' || child.path === '/emails/blocked-contacts') {
                            return isEmailEnabled && hasPermission('view_marketing');
                        }
                        if (item.label === 'Analytics') return hasPermission('view_finance');
                        if (item.label === 'Growth') return hasPermission('view_marketing');
                        return true;
                    })
                };
            }
            return item;
        });
    }, [hasPermission, isAiManagerEnabled, isBotShieldEnabled, isEmailEnabled, isFeedsEnabled, isShippingEnabled]);

    // State for expanded groups
    const [expandedGroups, setExpandedGroups] = useState<string[]>([]);

    // State for unread inbox count
    const [hasUnread, setHasUnread] = useState(false);

    // Fetch unread conversations count and listen for new messages
    useEffect(() => {
        if (!accountId || !token) return;

        const controller = new AbortController();

        // Check for unread conversations count
        const checkUnread = async () => {
            try {
                const res = await fetch('/api/chat/unread-count', {
                    signal: controller.signal,
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': accountId
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    setHasUnread(data.count > 0);
                }
            } catch (error) {
                if ((error as Error).name === 'AbortError') return;
                // Silently fail
            }
        };

        checkUnread();

        // Listen for new messages via socket
        if (socket) {
            const handleNewMessage = () => {
                // Only set unread if not on inbox page
                if (!location.pathname.startsWith('/inbox')) {
                    setHasUnread(true);
                }
            };

            const handleConversationRead = () => {
                // Re-check unread count when a conversation is marked as read
                checkUnread();
            };

            socket.on('conversation:updated', handleNewMessage);
            socket.on('message:new', handleNewMessage);
            socket.on('conversation:read', handleConversationRead);

            return () => {
                controller.abort();
                socket.off('conversation:updated', handleNewMessage);
                socket.off('message:new', handleNewMessage);
                socket.off('conversation:read', handleConversationRead);
            };
        }

        return () => {
            controller.abort();
        };
    }, [accountId, token, socket, location.pathname]);

    // Clear unread when on inbox page
    useEffect(() => {
        if (location.pathname.startsWith('/inbox')) {
            // Defer state update to avoid cascading renders
            const timeoutId = setTimeout(() => {
                setHasUnread(false);
            }, 0);
            return () => clearTimeout(timeoutId);
        }
    }, [location.pathname]);

    // Auto-expand groups based on active route
    useEffect(() => {
        const activeGroup = navItems.find(item =>
            item.type === 'group' && item.children?.some(child => location.pathname.startsWith(child.path))
        );
        if (activeGroup && !isCollapsedView) {
            // Defer state update to avoid cascading renders
            const timeoutId = setTimeout(() => {
                // Use functional update to avoid dependency on expandedGroups
                setExpandedGroups(prev => {
                    if (!prev.includes(activeGroup.label)) {
                        return [...prev, activeGroup.label];
                    }
                    return prev;
                });
            }, 0);
            return () => clearTimeout(timeoutId);
        }
    }, [location.pathname, isCollapsedView]);

    // Close drawer on navigation (mobile only)
    useEffect(() => {
        if (isMobile && onClose) {
            // Defer the close to avoid cascading renders
            const timeoutId = setTimeout(() => {
                onClose();
            }, 0);
            return () => clearTimeout(timeoutId);
        }
    }, [location.pathname, isMobile, onClose]);


    const toggleGroup = (label: string) => {
        if (isCollapsedView) {
            setCollapsed(false);
            setExpandedGroups([label]);
        } else {
            setExpandedGroups(prev =>
                prev.includes(label)
                    ? prev.filter(l => l !== label)
                    : [...prev, label]
            );
        }
    };

    const logoUrl = currentAccount?.appearance?.logoUrl;
    const appName = currentAccount?.appearance?.appName || 'OverSeek';
    const primaryColor = currentAccount?.appearance?.primaryColor || '#2563eb';

    // Shared sidebar content - extracted to avoid duplication
    const sidebarContent = (
        <>
            <div className="flex-col px-3 pt-4 pb-2">
                {/* Whitelabel Logo */}
                {logoUrl && (
                    <div className={cn("mb-4 flex justify-center", isCollapsedView ? "px-0" : "px-2")}>
                        <img src={logoUrl} alt={appName} className="max-h-8 object-contain" />
                    </div>
                )}

                {/* Account Switcher or Default Logo */}
                {!isCollapsedView ? (
                    <AccountSwitcher />
                ) : (
                    // Only show default 'O' if no logo is provided
                    !logoUrl && (
                        <div
                            className="h-10 w-10 rounded-sm flex items-center justify-center text-white font-bold mx-auto mb-4"
                            style={{ backgroundColor: primaryColor }}
                        >
                            {appName.charAt(0)}
                        </div>
                    )
                )}
            </div>

            <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1 no-scrollbar">
                {filteredNavItems.map((item) => {
                    if (item.type === 'link') {
                        const isInbox = item.label === 'Inbox';
                        return (
                            <NavLink
                                key={item.path}
                                to={item.path!}
                                onMouseEnter={() => prefetch(item.path!)}
                                onFocus={() => prefetch(item.path!)}
                                title={isCollapsedView ? item.label : undefined}
                                aria-label={isCollapsedView ? item.label : undefined}
                                className={({ isActive }) => cn(
                                    "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative",
                                    isActive
                                        ? "bg-gradient-to-r from-blue-500/10 to-violet-500/10 text-blue-600 font-medium shadow-sm dark:from-blue-500/20 dark:to-violet-500/20"
                                        : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/50 dark:hover:text-slate-200"
                                )}
                            >
                                <div className="relative">
                                    <item.icon size={22} strokeWidth={1.5} />
                                    {/* Notification dot for Inbox */}
                                    {isInbox && hasUnread && (
                                        <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 rounded-full ring-2 ring-white" />
                                    )}
                                </div>
                                {!isCollapsedView && <span>{item.label}</span>}
                                {isCollapsedView && (
                                    <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded-sm opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                                        {item.label}
                                        {isInbox && hasUnread && <span className="ml-1 text-red-400">•</span>}
                                    </div>
                                )}
                            </NavLink>
                        );
                    }


                    // Group Item
                    const isExpanded = expandedGroups.includes(item.label);
                    const isActiveGroup = item.children?.some(child => location.pathname.startsWith(child.path));

                    return (
                        <div key={item.label} className="mb-1">
                            <button
                                onClick={() => toggleGroup(item.label)}
                                aria-expanded={isExpanded}
                                aria-label={isCollapsedView ? item.label : undefined}
                                title={isCollapsedView ? item.label : undefined}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative",
                                    isActiveGroup && !isExpanded
                                        ? "bg-gradient-to-r from-blue-500/10 to-violet-500/10 text-blue-600 dark:from-blue-500/20 dark:to-violet-500/20"
                                        : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/50 dark:hover:text-slate-200"
                                )}
                            >
                                <item.icon size={22} strokeWidth={1.5} className={cn(isActiveGroup ? "text-blue-600" : "")} />
                                {!isCollapsedView && (
                                    <>
                                        <span className="flex-1 text-left font-medium text-sm">{item.label}</span>
                                        <ChevronDown
                                            size={16}
                                            className={cn("transition-transform duration-200", isExpanded ? "transform rotate-180" : "")}
                                        />
                                    </>
                                )}

                                {/* Collapsed Tooltip/Popover preview */}
                                {isCollapsedView && (
                                    <div className="absolute left-full ml-2 top-0 bg-white border border-gray-200 shadow-lg rounded-lg p-2 min-w-[160px] opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none group-hover:pointer-events-auto">
                                        <div className="font-semibold text-xs text-gray-400 mb-2 px-2 uppercase">{item.label}</div>
                                        {item.children?.map(child => (
                                            <NavLink
                                                key={child.path}
                                                to={child.path}
                                                end
                                                onMouseEnter={() => prefetch(child.path)}
                                                onFocus={() => prefetch(child.path)}
                                                className={({ isActive }) => cn(
                                                    "flex items-center gap-2 px-2 py-1.5 text-sm rounded-md",
                                                    isActive
                                                        ? "bg-blue-500/10 text-blue-600 font-medium"
                                                        : "text-gray-600 hover:bg-slate-100/80 hover:text-slate-800"
                                                )}
                                            >
                                                <child.icon size={16} />
                                                <span>{child.label}</span>
                                            </NavLink>
                                        ))}
                                    </div>
                                )}
                            </button>

                            {/* Expanded Children (Only when not collapsed or on mobile) */}
                            {!isCollapsedView && isExpanded && (
                                <div className="mt-1 ml-4 border-l-2 border-slate-200/60 dark:border-slate-600/40 pl-2 space-y-0.5">
                                    {item.children?.map(child => (
                                        <NavLink
                                            key={child.path}
                                            to={child.path}
                                            end
                                            onMouseEnter={() => prefetch(child.path)}
                                            onFocus={() => prefetch(child.path)}
                                            className={({ isActive }) => cn(
                                                "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-sm",
                                                isActive
                                                    ? "bg-blue-500/10 text-blue-600 font-medium dark:bg-blue-500/20"
                                                    : "text-slate-500 hover:bg-slate-100/80 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700/50 dark:hover:text-slate-300"
                                            )}
                                        >
                                            <child.icon size={18} strokeWidth={1.5} />
                                            <span>{child.label}</span>
                                        </NavLink>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}

            </div>

            <div className="mt-auto px-3 pb-3 space-y-2 border-t border-slate-200/60 dark:border-slate-600/40 pt-3">
                {/* Settings Link (Pinned Bottom) */}
                <NavLink
                    to="/settings"
                    title={isCollapsedView ? 'Settings' : undefined}
                    aria-label={isCollapsedView ? 'Settings' : undefined}
                    className={({ isActive }) => cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative mb-2",
                        isActive
                            ? "bg-gradient-to-r from-blue-500/10 to-violet-500/10 text-blue-600 font-medium dark:from-blue-500/20 dark:to-violet-500/20"
                            : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/50 dark:hover:text-slate-200"
                    )}
                >
                    <Settings size={22} strokeWidth={1.5} />
                    {!isCollapsedView && <span>Settings</span>}
                    {isCollapsedView && (
                        <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded-sm opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                            Settings
                        </div>
                    )}
                </NavLink>

                <SidebarSyncStatus collapsed={isCollapsedView} />

            </div>
        </>
    );

    // Mobile: render as fixed overlay drawer
    if (isMobile) {
        return (
            <>
                {/* Backdrop with blur */}
                {isOpen && (
                    <div
                        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40 transition-opacity duration-300"
                        onClick={onClose}
                    />
                )}
                <aside
                    className={cn(
                        "fixed inset-y-0 left-0 w-72 flex flex-col z-50 transition-transform duration-300 ease-out",
                        "bg-gradient-to-b from-white to-slate-50 dark:from-slate-900 dark:to-slate-950",
                        "border-r border-slate-200/80 dark:border-slate-700/50",
                        "shadow-2xl shadow-slate-900/10 dark:shadow-slate-900/50",
                        isOpen ? "translate-x-0" : "-translate-x-full"
                    )}
                >
                    {/* Close button for mobile */}
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl z-10 transition-all duration-200 dark:hover:bg-slate-700/50 dark:hover:text-slate-300"
                    >
                        <X size={20} />
                    </button>
                    {sidebarContent}
                </aside>
            </>
        );
    }

    // Desktop: render as sticky sidebar (CSS hides on mobile via hidden lg:flex)
    return (
        <aside
            onMouseEnter={handleSidebarEnter}
            onMouseLeave={startCollapseDelay}
            onFocusCapture={handleSidebarEnter}
            onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    startCollapseDelay();
                }
            }}
            className={cn(
                "h-screen sticky top-0 transition-all duration-300 flex-col z-50",
                "bg-gradient-to-b from-white via-white to-slate-50/80 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950",
                "border-r border-slate-200/80 dark:border-slate-700/50",
                "hidden lg:flex", // Critical: CSS-hide on mobile
                isCollapsedView ? "w-20" : "w-64"
            )}
        >
            {sidebarContent}
        </aside>
    );
});
