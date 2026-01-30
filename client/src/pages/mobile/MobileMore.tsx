import { useNavigate } from 'react-router-dom';
import {
    Package,
    Settings,
    Bell,
    User,
    LogOut,
    HelpCircle,
    ChevronRight,
    Smartphone,
    Users,
    Eye
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * MobileMore - Premium dark glassmorphism settings menu for mobile PWA.
 * 
 * Provides access to:
 * - Inventory & Customers
 * - Settings & Notifications
 * - Profile
 * - Help & Logout
 */

interface MenuItem {
    id: string;
    label: string;
    icon: typeof Package;
    path?: string;
    action?: () => void;
    badge?: string;
    iconColor?: string;
    iconBg?: string;
    danger?: boolean;
}

export function MobileMore() {
    const navigate = useNavigate();
    const { logout, user } = useAuth();

    /**
     * Triggers haptic feedback if supported.
     */
    const triggerHaptic = (duration = 10) => {
        if ('vibrate' in navigator) {
            navigator.vibrate(duration);
        }
    };

    const handleLogout = () => {
        triggerHaptic(20);
        if (confirm('Are you sure you want to log out?')) {
            logout();
            navigate('/login');
        }
    };

    const handleNavigate = (path: string) => {
        triggerHaptic();
        navigate(path);
    };

    const menuSections: { title: string; items: MenuItem[] }[] = [
        {
            title: 'Store',
            items: [
                { id: 'inventory', label: 'Inventory', icon: Package, path: '/m/inventory', iconColor: 'text-orange-400', iconBg: 'bg-orange-500/20' },
                { id: 'customers', label: 'Customers', icon: Users, path: '/m/customers', iconColor: 'text-blue-400', iconBg: 'bg-blue-500/20' },
                { id: 'visitors', label: 'Live Visitors', icon: Eye, path: '/m/visitors', iconColor: 'text-emerald-400', iconBg: 'bg-emerald-500/20' },
            ]
        },
        {
            title: 'Settings',
            items: [
                { id: 'notifications', label: 'Notifications', icon: Bell, path: '/m/notifications', iconColor: 'text-purple-400', iconBg: 'bg-purple-500/20' },
                { id: 'profile', label: 'Profile', icon: User, path: '/m/profile', iconColor: 'text-indigo-400', iconBg: 'bg-indigo-500/20' },
                { id: 'settings', label: 'App Settings', icon: Settings, path: '/m/settings', iconColor: 'text-slate-400', iconBg: 'bg-slate-500/20' },
            ]
        },
        {
            title: 'Support',
            items: [
                { id: 'help', label: 'Help Center', icon: HelpCircle, path: '/help', iconColor: 'text-cyan-400', iconBg: 'bg-cyan-500/20' },
            ]
        },
        {
            title: '',
            items: [
                { id: 'logout', label: 'Log Out', icon: LogOut, action: handleLogout, danger: true, iconColor: 'text-red-400', iconBg: 'bg-red-500/20' },
            ]
        }
    ];

    return (
        <div className="space-y-6 animate-fade-slide-up">
            {/* User Card */}
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-5 text-white shadow-xl shadow-indigo-500/20">
                <div className="flex items-center gap-4">
                    {user?.avatarUrl ? (
                        <img
                            src={user.avatarUrl}
                            alt="Profile"
                            className="w-14 h-14 rounded-xl object-cover ring-2 ring-white/30"
                        />
                    ) : (
                        <div className="w-14 h-14 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-xl font-bold">
                            {user?.fullName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        <h2 className="font-semibold truncate text-lg">
                            {user?.fullName || 'User'}
                        </h2>
                        <p className="text-sm text-white/70 truncate">
                            {user?.email}
                        </p>
                    </div>
                    <button
                        onClick={() => handleNavigate('/m/profile')}
                        className="p-2 rounded-xl bg-white/10 active:bg-white/20 transition-colors"
                    >
                        <ChevronRight size={20} />
                    </button>
                </div>
                <div className="mt-4 pt-4 border-t border-white/20 flex items-center gap-2 text-sm text-white/80">
                    <Smartphone size={16} />
                    <span>OverSeek Companion v1.0</span>
                </div>
            </div>

            {/* Menu Sections */}
            {menuSections.map((section, idx) => (
                <div key={idx}>
                    {section.title && (
                        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">
                            {section.title}
                        </h3>
                    )}
                    <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl divide-y divide-white/5 overflow-hidden">
                        {section.items.map((item) => {
                            const Icon = item.icon;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => item.action ? item.action() : item.path && handleNavigate(item.path)}
                                    className="w-full flex items-center gap-4 p-4 text-left active:bg-white/5 transition-colors"
                                >
                                    <div className={`w-10 h-10 rounded-xl ${item.iconBg} flex items-center justify-center`}>
                                        <Icon size={20} className={item.iconColor} />
                                    </div>
                                    <span className={`flex-1 font-medium ${item.danger ? 'text-red-400' : 'text-white'}`}>
                                        {item.label}
                                    </span>
                                    {item.badge && (
                                        <span className="bg-indigo-500/20 text-indigo-400 text-xs font-medium px-2.5 py-1 rounded-lg">
                                            {item.badge}
                                        </span>
                                    )}
                                    {!item.action && (
                                        <ChevronRight size={18} className="text-slate-500" />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
