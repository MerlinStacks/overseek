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
    Moon,
    Shield
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * MobileMore - Settings and additional options menu for mobile.
 * 
 * Provides access to:
 * - Inventory
 * - Settings
 * - Notifications
 * - Profile
 * - Help
 * - Logout
 */

interface MenuItem {
    id: string;
    label: string;
    icon: typeof Package;
    path?: string;
    action?: () => void;
    badge?: string;
    color?: string;
}

export function MobileMore() {
    const navigate = useNavigate();
    const { logout, user } = useAuth();

    const handleLogout = () => {
        if (confirm('Are you sure you want to log out?')) {
            logout();
            navigate('/login');
        }
    };

    const menuSections: { title: string; items: MenuItem[] }[] = [
        {
            title: 'Store',
            items: [
                { id: 'inventory', label: 'Inventory', icon: Package, path: '/m/inventory' },
                { id: 'customers', label: 'Customers', icon: User, path: '/m/customers' },
            ]
        },
        {
            title: 'Settings',
            items: [
                { id: 'notifications', label: 'Notifications', icon: Bell, path: '/m/notifications' },
                { id: 'profile', label: 'Profile', icon: User, path: '/m/profile' },
                { id: 'settings', label: 'App Settings', icon: Settings, path: '/m/settings' },
            ]
        },
        {
            title: 'Support',
            items: [
                { id: 'help', label: 'Help Center', icon: HelpCircle, action: () => window.open('https://help.overseek.io', '_blank') },
            ]
        },
        {
            title: '',
            items: [
                { id: 'logout', label: 'Log Out', icon: LogOut, action: handleLogout, color: 'text-red-600' },
            ]
        }
    ];

    return (
        <div className="space-y-6">
            {/* User Card */}
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-5 text-white">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-xl font-bold">
                        {user?.fullName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="font-semibold truncate">
                            {user?.fullName || 'User'}
                        </h2>
                        <p className="text-sm text-white/80 truncate">
                            {user?.email}
                        </p>
                    </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-sm text-white/90">
                    <Smartphone size={16} />
                    <span>OverSeek Companion v1.0</span>
                </div>
            </div>

            {/* Menu Sections */}
            {menuSections.map((section, idx) => (
                <div key={idx}>
                    {section.title && (
                        <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2 px-1">
                            {section.title}
                        </h3>
                    )}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100">
                        {section.items.map((item) => {
                            const Icon = item.icon;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => item.action ? item.action() : item.path && navigate(item.path)}
                                    className="w-full flex items-center gap-4 p-4 text-left active:bg-gray-50 transition-colors"
                                >
                                    <Icon
                                        size={22}
                                        className={item.color || 'text-gray-600'}
                                    />
                                    <span className={`flex-1 font-medium ${item.color || 'text-gray-900'}`}>
                                        {item.label}
                                    </span>
                                    {item.badge && (
                                        <span className="bg-indigo-100 text-indigo-700 text-xs font-medium px-2 py-1 rounded-full">
                                            {item.badge}
                                        </span>
                                    )}
                                    {!item.action && (
                                        <ChevronRight size={20} className="text-gray-400" />
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
