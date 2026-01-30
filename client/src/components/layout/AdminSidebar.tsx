import { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import {
    LayoutDashboard,
    Users,
    FileText,
    Server,
    Radio,
    Key,
    Sparkles,
    Settings,
    ChevronLeft,
    ChevronRight,
    LogOut,
    Bug,
    HardDrive
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../context/AuthContext';

const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/admin' },
    { icon: Users, label: 'Accounts', path: '/admin/accounts' },
    { icon: HardDrive, label: 'Backups', path: '/admin/backups' },
    { icon: Key, label: 'Credentials', path: '/admin/credentials' },
    { icon: Sparkles, label: 'AI Prompts', path: '/admin/ai-prompts' },
    { icon: FileText, label: 'System Logs', path: '/admin/logs' },
    { icon: Radio, label: 'Broadcasts', path: '/admin/broadcast' },
    { icon: Bug, label: 'Diagnostics', path: '/admin/diagnostics' },
    { icon: Settings, label: 'Settings', path: '/admin/settings' },
];

export function AdminSidebar() {
    const [collapsed, setCollapsed] = useState(false);
    const { token } = useAuth();

    // Construct Bull Board URL with token for authentication in new tab
    const queueMonitorUrl = `/admin/queues${token ? `?token=${token}` : ''}`;

    return (
        <aside
            className={cn(
                "bg-slate-900 border-r border-slate-800 h-screen sticky top-0 transition-all duration-300 flex flex-col z-20 text-slate-300",
                collapsed ? "w-20" : "w-64"
            )}
        >
            <div className="flex flex-col px-3 pt-6 pb-4">
                <div className={cn("flex items-center gap-3 px-2 mb-8", collapsed ? "justify-center" : "")}>
                    <div className="h-8 w-8 rounded-sm bg-blue-600 flex items-center justify-center text-white font-bold shrink-0">
                        A
                    </div>
                    {!collapsed && (
                        <div>
                            <h1 className="font-bold text-white text-lg leading-none">Admin</h1>
                            <span className="text-xs text-slate-500">Super User Panel</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2 px-3 space-y-1 no-scrollbar">
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        end={item.path === '/admin'} // Exact match for root
                        className={({ isActive }) => cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group relative",
                            isActive
                                ? "bg-blue-600 text-white font-medium shadow-md shadow-blue-900/20"
                                : "text-slate-400 hover:bg-slate-800 hover:text-white"
                        )}
                    >
                        <item.icon size={22} strokeWidth={1.5} />
                        {!collapsed && <span>{item.label}</span>}

                        {collapsed && (
                            <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded-sm opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none border border-slate-700">
                                {item.label}
                            </div>
                        )}
                    </NavLink>
                ))}

                <div className="my-4 border-t border-slate-800 mx-2" />

                <a
                    href={queueMonitorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group relative text-slate-400 hover:bg-slate-800 hover:text-white"
                    )}
                >
                    <Server size={22} strokeWidth={1.5} />
                    {!collapsed && <span>Queue Monitor</span>}
                    {collapsed && (
                        <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded-sm opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none border border-slate-700">
                            Queue Monitor (Ext)
                        </div>
                    )}
                </a>
            </div>

            <div className="p-4 border-t border-slate-800">
                <Link
                    to="/"
                    className="flex items-center gap-3 w-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition-colors mb-2"
                >
                    <LogOut size={20} />
                    {!collapsed && <span>Back to App</span>}
                </Link>

                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="w-full flex items-center justify-center p-2 text-slate-500 hover:bg-slate-800 hover:text-white rounded-lg transition-colors"
                >
                    {collapsed ? <ChevronRight size={20} /> : <div className="flex items-center gap-2 text-sm"><ChevronLeft size={16} /> <span>Collapse</span></div>}
                </button>
            </div>
        </aside>
    );
}
