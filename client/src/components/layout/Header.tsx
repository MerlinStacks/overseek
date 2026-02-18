import { Search, Bell, HelpCircle, User, LogOut, Shield, Menu } from 'lucide-react';
import { Logger } from '../../utils/logger';
import { useState, useCallback } from 'react';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { SyncStatusBadge } from './SyncStatusBadge';
import { useCommandPalette } from '../../hooks/useCommandPalette';

interface HeaderProps {
    /** Callback when hamburger menu is clicked (mobile only) */
    onMenuClick?: () => void;
    /** Whether to show the hamburger menu button */
    showMenuButton?: boolean;
}

export function Header({ onMenuClick, showMenuButton = false }: HeaderProps) {
    const { token, user, logout } = useAuth();
    const { currentAccount } = useAccount();
    const { open: openSearch } = useCommandPalette();
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

    // Notifications State
    const [notifications, setNotifications] = useState<any[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showNotifications, setShowNotifications] = useState(false);

    // Poll Notifications with visibility-awareness
    const fetchNotifications = useCallback(async () => {
        if (!token || !currentAccount) return;
        try {
            const res = await fetch('/api/notifications?limit=10', {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (res.ok) {
                const data = await res.json();
                setNotifications(data.notifications);
                setUnreadCount(data.unreadCount);
            }
        } catch (error) {
            Logger.error('Notification poll failed', { error: error });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, currentAccount?.id]);

    useVisibilityPolling(fetchNotifications, 30000, [fetchNotifications], 'notifications');

    const markAllRead = async () => {
        if (!token || !currentAccount) return;
        try {
            await fetch('/api/notifications/read-all', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            setUnreadCount(0);
            setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
        } catch (e) { Logger.error('An error occurred', { error: e }); }
    };

    return (
        <header className="h-14 md:h-16 header-frosted px-4 md:px-8 flex items-center justify-between sticky top-0 z-40">
            <div className="flex items-center gap-4 md:gap-8">
                {/* Hamburger Menu Button (Mobile) */}
                {showMenuButton && (
                    <button
                        onClick={onMenuClick}
                        className="p-2 -ml-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        aria-label="Open menu"
                    >
                        <Menu size={24} />
                    </button>
                )}
            </div>

            <div className="flex items-center gap-3 md:gap-6">
                {/* Search Trigger Button */}
                <button
                    onClick={openSearch}
                    className="hidden md:flex items-center gap-3 w-72 pl-4 pr-3 py-2 text-sm bg-gray-50 hover:bg-gray-100 border border-transparent hover:border-gray-200 rounded-full transition-all cursor-pointer group"
                    type="button"
                >
                    <Search className="text-gray-400 group-hover:text-gray-500" size={18} />
                    <span className="text-gray-400 flex-1 text-left">Search...</span>
                    <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border border-gray-200 bg-white px-1.5 font-mono text-[10px] font-medium text-gray-400 pointer-events-none">
                        {navigator.platform.indexOf('Mac') > -1 ? '⌘' : 'Ctrl'}K
                    </kbd>
                </button>

                <div className="flex items-center gap-4 border-l border-gray-100 pl-6 relative">
                    {/* Notification Bell */}
                    <button
                        onClick={() => setShowNotifications(!showNotifications)}
                        className={`text-gray-400 hover:text-gray-600 relative ${showNotifications ? 'text-gray-600 bg-gray-100 rounded-lg p-1' : ''}`}
                    >
                        <Bell size={20} />
                        {unreadCount > 0 && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white font-bold">
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                        )}
                    </button>

                    {/* Notification Dropdown */}
                    {showNotifications && (
                        <div className="absolute top-12 right-0 w-80 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                            <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                                <h3 className="font-semibold text-gray-900 text-sm">Notifications</h3>
                                {unreadCount > 0 && (
                                    <button onClick={markAllRead} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                                        Mark all read
                                    </button>
                                )}
                            </div>
                            <div className="max-h-80 overflow-y-auto">
                                {notifications.length === 0 ? (
                                    <div className="p-8 text-center text-gray-500 text-sm">No new notifications</div>
                                ) : (
                                    notifications.map(n => (
                                        <div key={n.id} className={`p-4 border-b border-gray-50 hover:bg-gray-50 transition-colors ${!n.isRead ? 'bg-blue-50/50' : ''}`}>
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="text-sm font-medium text-gray-900">{n.title}</span>
                                                <span className="text-[10px] text-gray-400">{new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                            <p className="text-xs text-gray-600 leading-relaxed">{n.message}</p>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    <Link to="/help" className="text-gray-400 hover:text-gray-600">
                        <HelpCircle size={20} />
                    </Link>


                    {/* User Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                            className="flex items-center gap-3 pl-2 hover:bg-gray-50 rounded-lg p-1 transition-colors"
                        >
                            <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden border border-gray-200">
                                <img
                                    src={user?.avatarUrl || (user?.email ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}` : "https://api.dicebear.com/7.x/avataaars/svg?seed=fallback")}
                                    alt="User"
                                    className="w-full h-full object-cover"
                                />
                            </div>
                            <span className="text-sm font-medium text-gray-700 hidden sm:block max-w-[100px] truncate">
                                {user?.fullName || 'User'}
                            </span>
                        </button>

                        {isUserMenuOpen && (
                            <div className="absolute top-12 right-0 w-56 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                                    <p className="text-sm font-medium text-gray-900 truncate">{user?.fullName || 'User'}</p>
                                    <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                                </div>
                                <div className="py-1">
                                    {user?.isSuperAdmin && (
                                        <a
                                            href="/admin"
                                            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                        >
                                            <Shield size={16} className="text-gray-400" />
                                            Super Admin
                                        </a>
                                    )}
                                    <a
                                        href="/profile"
                                        className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                    >
                                        <User size={16} className="text-gray-400" />
                                        Profile
                                    </a>
                                    <button
                                        onClick={logout}
                                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors text-left"
                                    >
                                        <LogOut size={16} />
                                        Sign Out
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}
