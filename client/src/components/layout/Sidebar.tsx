import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    Users,
    BarChart3,
    Settings,
    ChevronLeft,
    ChevronRight,
    Megaphone,
    Shield,
    MessageSquare,
    Store,
    PieChart,
    TrendingUp,
    PenTool,
    ChevronDown,
    Star,
    ShieldAlert,
    LineChart,
    FileText,
    DollarSign,
    GitBranch,
    Repeat,
    X,
    BookOpen,
    Zap
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { AccountSwitcher } from './AccountSwitcher';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { SyncProgressOverlay } from './SyncProgressOverlay';
import { SidebarSyncStatus } from './SidebarSyncStatus';

interface SidebarProps {
    /** Mobile drawer mode - whether sidebar is open */
    isOpen?: boolean;
    /** Callback to close mobile drawer */
    onClose?: () => void;
    /** Whether we're in mobile mode (drawer behavior) */
    isMobile?: boolean;
}

const navItems = [
    { type: 'link', icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { type: 'link', icon: MessageSquare, label: 'Inbox', path: '/inbox' },
    {
        type: 'group',
        label: 'Commerce',
        icon: Store,
        children: [
            { icon: ShoppingCart, label: 'Orders', path: '/orders' },
            { icon: Package, label: 'Inventory', path: '/inventory' },
            { icon: Users, label: 'Customers', path: '/customers' },
        ]
    },
    {
        type: 'group',
        label: 'Analytics',
        icon: PieChart,
        children: [
            { icon: LineChart, label: 'Overview', path: '/analytics' },
            { icon: DollarSign, label: 'Revenue', path: '/analytics/revenue' },
            { icon: GitBranch, label: 'Attribution', path: '/analytics/attribution' },
            { icon: TrendingUp, label: 'Cohorts', path: '/analytics/cohorts' },
            { icon: Repeat, label: 'Customers', path: '/analytics/customers' },
            { icon: BarChart3, label: 'Acquisition', path: '/live' },
            { icon: BarChart3, label: 'Reports', path: '/reports' },
        ]
    },
    {
        type: 'group',
        label: 'Growth',
        icon: TrendingUp,
        children: [
            { icon: Star, label: 'Reviews', path: '/reviews' },
            { icon: Megaphone, label: 'Marketing', path: '/marketing' },
            { icon: Zap, label: 'Flows', path: '/flows' },
        ]
    },
    {
        type: 'group',
        label: 'Tools',
        icon: PenTool,
        children: [
            { icon: FileText, label: 'Invoice Designer', path: '/invoices/design' },
        ]
    },
    {
        type: 'group',
        label: 'Operations',
        icon: BookOpen,
        children: [
            { icon: FileText, label: 'Policies & SOP', path: '/policies' },
        ]
    },
    { type: 'link', icon: Shield, label: 'Team', path: '/team' },
];

export function Sidebar({ isOpen = true, onClose, isMobile = false }: SidebarProps) {
    const [collapsed, setCollapsed] = useState(false);
    const { currentAccount } = useAccount();
    const { user, token } = useAuth();
    const { socket } = useSocket();
    const location = useLocation();

    // State for expanded groups
    const [expandedGroups, setExpandedGroups] = useState<string[]>([]);

    // State for unread inbox count
    const [hasUnread, setHasUnread] = useState(false);

    // Fetch unread conversations count and listen for new messages
    useEffect(() => {
        if (!currentAccount || !token) return;

        // Check for open conversations (unread indicator)
        const checkUnread = async () => {
            try {
                const res = await fetch('/api/chat/conversations', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });
                if (res.ok) {
                    const conversations = await res.json();
                    // Has unread if there are any OPEN conversations
                    setHasUnread(conversations.length > 0);
                }
            } catch {
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

            socket.on('conversation:updated', handleNewMessage);
            socket.on('message:new', handleNewMessage);

            return () => {
                socket.off('conversation:updated', handleNewMessage);
                socket.off('message:new', handleNewMessage);
            };
        }
    }, [currentAccount, token, socket, location.pathname]);

    // Clear unread when on inbox page
    useEffect(() => {
        if (location.pathname.startsWith('/inbox')) {
            setHasUnread(false);
        }
    }, [location.pathname]);

    // Auto-expand groups based on active route
    useEffect(() => {
        const activeGroup = navItems.find(item =>
            item.type === 'group' && item.children?.some(child => location.pathname.startsWith(child.path))
        );
        if (activeGroup && !expandedGroups.includes(activeGroup.label) && !collapsed) {
            setExpandedGroups(prev => [...prev, activeGroup.label]);
        }
    }, [location.pathname, collapsed]);

    // Close drawer on navigation (mobile only)
    useEffect(() => {
        if (isMobile && onClose) {
            onClose();
        }
    }, [location.pathname]);


    const toggleGroup = (label: string) => {
        if (collapsed && !isMobile) {
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
                    <div className={cn("mb-4 flex justify-center", (collapsed && !isMobile) ? "px-0" : "px-2")}>
                        <img src={logoUrl} alt={appName} className="max-h-8 object-contain" />
                    </div>
                )}

                {/* Account Switcher or Default Logo */}
                {(!collapsed || isMobile) ? (
                    <AccountSwitcher />
                ) : (
                    // Only show default 'O' if no logo is provided
                    !logoUrl && (
                        <div
                            className="h-10 w-10 rounded flex items-center justify-center text-white font-bold mx-auto mb-4"
                            style={{ backgroundColor: primaryColor }}
                        >
                            {appName.charAt(0)}
                        </div>
                    )
                )}
            </div>

            <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1 no-scrollbar">
                {navItems.map((item, index) => {
                    if (item.type === 'link') {
                        const isInbox = item.label === 'Inbox';
                        return (
                            <NavLink
                                key={item.path}
                                to={item.path!}
                                className={({ isActive }) => cn(
                                    "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group relative",
                                    isActive
                                        ? "bg-blue-50 text-blue-600 font-medium"
                                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                                )}
                            >
                                <div className="relative">
                                    <item.icon size={22} strokeWidth={1.5} />
                                    {/* Notification dot for Inbox */}
                                    {isInbox && hasUnread && (
                                        <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 rounded-full ring-2 ring-white" />
                                    )}
                                </div>
                                {(!collapsed || isMobile) && <span>{item.label}</span>}
                                {collapsed && !isMobile && (
                                    <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
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
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group relative",
                                    isActiveGroup && !isExpanded
                                        ? "bg-blue-50/50 text-blue-600"
                                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                                )}
                            >
                                <item.icon size={22} strokeWidth={1.5} className={cn(isActiveGroup ? "text-blue-600" : "")} />
                                {(!collapsed || isMobile) && (
                                    <>
                                        <span className="flex-1 text-left font-medium text-sm">{item.label}</span>
                                        <ChevronDown
                                            size={16}
                                            className={cn("transition-transform duration-200", isExpanded ? "transform rotate-180" : "")}
                                        />
                                    </>
                                )}

                                {/* Collapsed Tooltip/Popover preview */}
                                {collapsed && !isMobile && (
                                    <div className="absolute left-full ml-2 top-0 bg-white border border-gray-200 shadow-lg rounded-lg p-2 min-w-[160px] opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none group-hover:pointer-events-auto">
                                        <div className="font-semibold text-xs text-gray-400 mb-2 px-2 uppercase">{item.label}</div>
                                        {item.children?.map(child => (
                                            <div key={child.path} className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-600">
                                                <child.icon size={16} />
                                                <span>{child.label}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </button>

                            {/* Expanded Children (Only when not collapsed or on mobile) */}
                            {(!collapsed || isMobile) && isExpanded && (
                                <div className="mt-1 ml-4 border-l-2 border-gray-100 pl-2 space-y-1">
                                    {item.children?.map(child => (
                                        <NavLink
                                            key={child.path}
                                            to={child.path}
                                            end
                                            className={({ isActive }) => cn(
                                                "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm",
                                                isActive
                                                    ? "bg-blue-50 text-blue-600 font-medium"
                                                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
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

                {user?.isSuperAdmin && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                        <NavLink
                            to="/admin"
                            className={({ isActive }) => cn(
                                "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group relative",
                                isActive
                                    ? "bg-slate-800 text-white font-medium"
                                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            )}
                        >
                            <ShieldAlert size={22} strokeWidth={1.5} />
                            {(!collapsed || isMobile) && <span>Super Admin</span>}

                            {collapsed && !isMobile && (
                                <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                                    Super Admin
                                </div>
                            )}
                        </NavLink>
                    </div>
                )}
            </div>

            <SyncProgressOverlay collapsed={collapsed && !isMobile} />

            <div className="mt-auto px-3 pb-2 z-10">
                {/* Settings Link (Pinned Bottom) */}
                <NavLink
                    to="/settings"
                    className={({ isActive }) => cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group relative mb-2",
                        isActive
                            ? "bg-blue-50 text-blue-600 font-medium"
                            : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                    )}
                >
                    <Settings size={22} strokeWidth={1.5} />
                    {(!collapsed || isMobile) && <span>Settings</span>}
                    {collapsed && !isMobile && (
                        <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                            Settings
                        </div>
                    )}
                </NavLink>

                <SidebarSyncStatus collapsed={collapsed && !isMobile} />
            </div>

            {/* Collapse button (desktop only) */}
            {!isMobile && (
                <div className="p-4 border-t border-gray-100">
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="w-full flex items-center justify-center p-2 text-gray-400 hover:bg-gray-50 rounded-lg transition-colors"
                    >
                        {collapsed ? <ChevronRight size={20} /> : <div className="flex items-center gap-2 text-sm"><ChevronLeft size={16} /> <span>Collapse</span></div>}
                    </button>
                </div>
            )}
        </>
    );

    // Mobile: render as fixed overlay drawer
    if (isMobile) {
        return (
            <>
                {/* Backdrop */}
                {isOpen && (
                    <div
                        className="fixed inset-0 bg-black/50 z-40"
                        onClick={onClose}
                    />
                )}
                <aside
                    className={cn(
                        "fixed inset-y-0 left-0 bg-white border-r border-gray-200 w-72 flex flex-col z-50 transition-transform duration-300 ease-in-out",
                        isOpen ? "translate-x-0" : "-translate-x-full"
                    )}
                >
                    {/* Close button for mobile */}
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg z-10"
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
            className={cn(
                "bg-white border-r border-gray-200 h-screen sticky top-0 transition-all duration-300 flex-col z-50",
                "hidden lg:flex", // Critical: CSS-hide on mobile
                collapsed ? "w-20" : "w-64"
            )}
        >
            {sidebarContent}
        </aside>
    );
}
