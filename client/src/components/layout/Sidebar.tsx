import { useState } from 'react';
import { NavLink } from 'react-router-dom';
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
    Briefcase,
    Shield,
    MessageSquare,

    Star,
    ShieldAlert,
    LineChart
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { AccountSwitcher } from './AccountSwitcher';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { SyncProgressOverlay } from './SyncProgressOverlay';
import { SidebarSyncStatus } from './SidebarSyncStatus';

const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: LineChart, label: 'Analytics', path: '/analytics' },
    { icon: ShoppingCart, label: 'Orders', path: '/orders' },
    { icon: Package, label: 'Inventory', path: '/inventory' },
    { icon: Users, label: 'Customers', path: '/customers' },
    { icon: MessageSquare, label: 'Inbox', path: '/inbox' },
    { icon: Star, label: 'Reviews', path: '/reviews' },
    { icon: Megaphone, label: 'Marketing', path: '/marketing' },

    { icon: BarChart3, label: 'Reports', path: '/reports' },
    { icon: Shield, label: 'Team', path: '/team' },
    { icon: Settings, label: 'Settings', path: '/settings' },
];

export function Sidebar() {
    const [collapsed, setCollapsed] = useState(false);
    const { currentAccount } = useAccount();
    const { user } = useAuth();

    const logoUrl = currentAccount?.appearance?.logoUrl;
    const appName = currentAccount?.appearance?.appName || 'OverSeek';
    const primaryColor = currentAccount?.appearance?.primaryColor || '#2563eb';

    return (
        <aside
            className={cn(
                "bg-white border-r border-gray-200 h-screen sticky top-0 transition-all duration-300 flex flex-col z-50",
                collapsed ? "w-20" : "w-64"
            )}
        >
            <div className="flex-col px-3 pt-4 pb-2">
                {/* Whitelabel Logo */}
                {logoUrl && (
                    <div className={cn("mb-4 flex justify-center", collapsed ? "px-0" : "px-2")}>
                        <img src={logoUrl} alt={appName} className="max-h-8 object-contain" />
                    </div>
                )}

                {/* Account Switcher or Default Logo */}
                {!collapsed ? (
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

            <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) => cn(
                            "flex items-center gap-3 px-3 py-3 rounded-lg transition-colors group relative",
                            isActive
                                ? "bg-blue-50 text-blue-600 font-medium"
                                : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                        )}
                    >
                        <item.icon size={22} strokeWidth={1.5} />
                        {!collapsed && <span>{item.label}</span>}

                        {/* Tooltip for collapsed state */}
                        {collapsed && (
                            <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                                {item.label}
                            </div>
                        )}
                    </NavLink>
                ))}

                {user?.isSuperAdmin && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                        <NavLink
                            to="/admin"
                            className={({ isActive }) => cn(
                                "flex items-center gap-3 px-3 py-3 rounded-lg transition-colors group relative",
                                isActive
                                    ? "bg-slate-800 text-white font-medium"
                                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            )}
                        >
                            <ShieldAlert size={22} strokeWidth={1.5} />
                            {!collapsed && <span>Super Admin</span>}

                            {collapsed && (
                                <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                                    Super Admin
                                </div>
                            )}
                        </NavLink>
                    </div>
                )}
            </div>

            <SyncProgressOverlay collapsed={collapsed} />

            <div className="mt-auto">
                <SidebarSyncStatus collapsed={collapsed} />
                <div className="p-4 border-t border-gray-100">
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="w-full flex items-center justify-center p-2 text-gray-400 hover:bg-gray-50 rounded-lg transition-colors"
                    >
                        {collapsed ? <ChevronRight size={20} /> : <div className="flex items-center gap-2 text-sm"><ChevronLeft size={16} /> <span>Collapse</span></div>}
                    </button>
                </div>
            </div>
        </aside>
    );
}
