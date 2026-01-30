import { useNavigate } from 'react-router-dom';
import {
    LayoutDashboard,
    ShoppingCart,
    Inbox,
    BarChart3,
    MoreHorizontal
} from 'lucide-react';

/**
 * MobileNav - Premium bottom navigation bar for the PWA.
 * 
 * Features:
 * - Glassmorphism design with blur backdrop
 * - Animated pill indicator
 * - Badge support with pulse animation
 * - Haptic feedback on tap
 */

interface MobileNavProps {
    activeTab: string;
    ordersBadge?: number;
    inboxBadge?: number;
}

interface NavItem {
    id: string;
    label: string;
    path: string;
    icon: typeof LayoutDashboard;
}

const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Home', path: '/m/dashboard', icon: LayoutDashboard },
    { id: 'orders', label: 'Orders', path: '/m/orders', icon: ShoppingCart },
    { id: 'inbox', label: 'Inbox', path: '/m/inbox', icon: Inbox },
    { id: 'analytics', label: 'Analytics', path: '/m/analytics', icon: BarChart3 },
    { id: 'more', label: 'More', path: '/m/more', icon: MoreHorizontal },
];

export function MobileNav({ activeTab, ordersBadge, inboxBadge }: MobileNavProps) {
    const navigate = useNavigate();

    const handleNavClick = (path: string) => {
        // Haptic feedback
        if ('vibrate' in navigator) {
            navigator.vibrate(10);
        }
        navigate(path);
    };

    const getBadge = (id: string): number | undefined => {
        if (id === 'orders') return ordersBadge;
        if (id === 'inbox') return inboxBadge;
        return undefined;
    };

    const activeIndex = navItems.findIndex(item => item.id === activeTab);

    return (
        <nav
            className="fixed bottom-0 left-0 right-0 z-50"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
            {/* Glassmorphism background */}
            <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-xl border-t border-white/10" />

            {/* Animated pill indicator */}
            <div
                className="absolute top-0 h-0.5 bg-gradient-to-r from-indigo-400 via-purple-400 to-indigo-400 rounded-full transition-all duration-300 ease-out"
                style={{
                    width: `${100 / navItems.length}%`,
                    left: `${(activeIndex / navItems.length) * 100}%`,
                }}
            />

            <div className="relative flex items-center justify-around h-16">
                {navItems.map((item, index) => {
                    const isActive = activeTab === item.id;
                    const badge = getBadge(item.id);
                    const Icon = item.icon;

                    return (
                        <button
                            key={item.id}
                            onClick={() => handleNavClick(item.path)}
                            className={`
                                flex flex-col items-center justify-center flex-1 h-full
                                transition-all duration-200 relative group
                                ${isActive
                                    ? 'text-white'
                                    : 'text-slate-400 active:text-slate-300'
                                }
                            `}
                        >
                            {/* Background glow for active item */}
                            {isActive && (
                                <div className="absolute inset-0 bg-gradient-to-t from-indigo-500/20 to-transparent pointer-events-none" />
                            )}

                            <div className="relative">
                                <div className={`
                                    p-1.5 rounded-xl transition-all duration-200
                                    ${isActive ? 'bg-indigo-500/20 scale-110' : 'group-active:scale-95'}
                                `}>
                                    <Icon
                                        size={22}
                                        strokeWidth={isActive ? 2.5 : 1.8}
                                        className={isActive ? 'drop-shadow-[0_0_8px_rgba(129,140,248,0.5)]' : ''}
                                    />
                                </div>

                                {/* Badge with pulse animation */}
                                {badge !== undefined && badge > 0 && (
                                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-gradient-to-br from-red-400 to-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 shadow-lg shadow-red-500/30 animate-pulse">
                                        {badge > 99 ? '99+' : badge}
                                    </span>
                                )}
                            </div>

                            <span className={`
                                text-[10px] mt-0.5 transition-all duration-200
                                ${isActive ? 'font-semibold text-indigo-300' : 'font-medium'}
                            `}>
                                {item.label}
                            </span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
