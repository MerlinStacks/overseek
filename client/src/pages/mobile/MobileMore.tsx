import { useNavigate } from 'react-router-dom';
import {
    Bell,
    ChevronRight,
    Eye,
    LogOut,
    MessageSquare,
    Package,
    Settings,
    User,
    Users,
    type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useHaptic } from '../../hooks/useHaptic';

interface MenuItem {
    id: string;
    label: string;
    description: string;
    icon: LucideIcon;
    path?: string;
    action?: () => void;
    iconColor: string;
    iconBg: string;
    danger?: boolean;
}

interface MenuSection {
    title: string;
    items: MenuItem[];
}

export function MobileMore() {
    const navigate = useNavigate();
    const { logout, user } = useAuth();
    const { currentAccount } = useAccount();
    const { triggerHaptic } = useHaptic();

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

    const menuSections: MenuSection[] = [
        {
            title: 'Store tools',
            items: [
                {
                    id: 'inventory',
                    label: 'Inventory',
                    description: 'Stock levels and product checks',
                    icon: Package,
                    path: '/m/inventory',
                    iconColor: 'text-amber-100',
                    iconBg: 'bg-amber-400/15',
                },
                {
                    id: 'customers',
                    label: 'Customers',
                    description: 'Customer records and order history',
                    icon: Users,
                    path: '/m/customers',
                    iconColor: 'text-sky-100',
                    iconBg: 'bg-sky-400/15',
                },
                {
                    id: 'reviews',
                    label: 'Reviews',
                    description: 'Read and moderate customer reviews',
                    icon: MessageSquare,
                    path: '/m/reviews',
                    iconColor: 'text-emerald-100',
                    iconBg: 'bg-emerald-400/15',
                },
                {
                    id: 'live-visitors',
                    label: 'Live visitors',
                    description: 'See who is browsing right now',
                    icon: Eye,
                    path: '/m/live-visitors',
                    iconColor: 'text-emerald-100',
                    iconBg: 'bg-emerald-400/15',
                },
            ],
        },
        {
            title: 'Account',
            items: [
                {
                    id: 'notifications',
                    label: 'Notifications',
                    description: 'Push setup and notification status',
                    icon: Bell,
                    path: '/m/notifications',
                    iconColor: 'text-violet-100',
                    iconBg: 'bg-violet-400/15',
                },
                {
                    id: 'profile',
                    label: 'Profile',
                    description: 'Name, avatar, and account details',
                    icon: User,
                    path: '/m/profile',
                    iconColor: 'text-indigo-100',
                    iconBg: 'bg-indigo-400/15',
                },
                {
                    id: 'settings',
                    label: 'Settings',
                    description: 'Store sync and mobile preferences',
                    icon: Settings,
                    path: '/m/settings',
                    iconColor: 'text-slate-100',
                    iconBg: 'bg-slate-400/15',
                },
            ],
        },
        {
            title: 'Session',
            items: [
                {
                    id: 'logout',
                    label: 'Log out',
                    description: 'End this mobile session',
                    icon: LogOut,
                    action: handleLogout,
                    danger: true,
                    iconColor: 'text-rose-100',
                    iconBg: 'bg-rose-400/15',
                },
            ],
        },
    ];

    const initial = user?.fullName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U';

    return (
        <div className="space-y-5 pb-28 animate-fade-slide-up">
            <button
                onClick={() => handleNavigate('/m/profile')}
                className="flex w-full items-center gap-4 rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 text-left shadow-lg shadow-black/20 active:scale-[0.99]"
            >
                {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="Profile" className="h-14 w-14 rounded-2xl object-cover ring-1 ring-white/20" />
                ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500 text-xl font-black text-white shadow-lg shadow-indigo-500/25">
                        {initial}
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-black text-white">{user?.fullName || 'Profile'}</p>
                    <p className="truncate text-sm text-slate-400">{user?.email || 'Manage your account'}</p>
                    {currentAccount?.name && <p className="mt-1 truncate text-xs font-bold text-indigo-200">{currentAccount.name}</p>}
                </div>
                <ChevronRight size={18} className="shrink-0 text-slate-600" />
            </button>

            {menuSections.map((section) => (
                <section key={section.title}>
                    <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-wider text-slate-500">{section.title}</h2>
                    <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950 shadow-lg shadow-black/20">
                        {section.items.map((item) => {
                            const Icon = item.icon;

                            return (
                                <button
                                    key={item.id}
                                    onClick={() => item.action ? item.action() : item.path && handleNavigate(item.path)}
                                    className="flex w-full items-center gap-3 border-b border-white/5 p-4 text-left last:border-b-0 active:bg-white/[0.06]"
                                >
                                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${item.iconBg} ring-1 ring-white/10`}>
                                        <Icon size={19} className={item.iconColor} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className={`font-black ${item.danger ? 'text-rose-200' : 'text-white'}`}>{item.label}</p>
                                        <p className="mt-0.5 truncate text-sm text-slate-500">{item.description}</p>
                                    </div>
                                    {!item.action && <ChevronRight size={17} className="shrink-0 text-slate-600" />}
                                </button>
                            );
                        })}
                    </div>
                </section>
            ))}

            <p className="px-1 text-center text-xs text-slate-600">OverSeek Companion v1.0</p>
        </div>
    );
}
