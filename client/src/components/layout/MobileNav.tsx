import { useNavigate } from 'react-router-dom';
import {
    LayoutDashboard,
    ShoppingCart,
    Inbox,
    BarChart3,
    MoreHorizontal
} from 'lucide-react';

/**
 * MobileNav - Account-accented bottom navigation for the companion.
 * 
 * Features:
 * - Clear active state and static, readable badges
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

    return (
        <nav
            className="mobile-nav fixed bottom-0 left-0 right-0 z-50"
            aria-label="Main navigation"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
            <div className="relative flex items-center justify-around h-16">
                {navItems.map((item) => {
                    const isActive = activeTab === item.id;
                    const badge = getBadge(item.id);
                    const Icon = item.icon;

                    return (
                        <button
                            key={item.id}
                            aria-current={isActive ? 'page' : undefined}
                            aria-label={`${item.label}${badge ? `, ${badge} ${item.id === 'inbox' ? 'unread' : 'pending'}` : ''}`}
                            onClick={() => handleNavClick(item.path)}
                            className={`
                                flex flex-col items-center justify-center flex-1 h-full
                                transition-all duration-200 relative group
                                ${isActive
                                    ? 'mobile-nav-active'
                                    : 'text-slate-400 active:text-slate-300'
                                }
                            `}
                        >
                            <div className="relative">
                                <div className={`
                                    p-1.5 rounded-xl transition-all duration-200
                                    ${isActive ? 'mobile-brand-soft' : 'group-active:scale-95'}
                                `}>
                                    <Icon
                                        size={22}
                                        strokeWidth={isActive ? 2.5 : 1.8}
                                    />
                                </div>

                                {/* Badge with pulse animation */}
                                {badge !== undefined && badge > 0 && (
                                    <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-rose-600 text-white text-[10px] font-semibold rounded-full flex items-center justify-center px-1">
                                        {badge > 99 ? '99+' : badge}
                                    </span>
                                )}
                            </div>

                            <span className={`
                                text-[10px] mt-0.5 transition-all duration-200
                                ${isActive ? 'font-semibold' : 'font-medium'}
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
