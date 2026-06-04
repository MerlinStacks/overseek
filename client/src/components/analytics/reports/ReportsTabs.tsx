import type { ReactNode } from 'react';
import { BarChart3, Boxes, Lock, PieChart, Sparkles, Wrench } from 'lucide-react';

type ReportsTab = 'overview' | 'stock_velocity' | 'profitability' | 'premade' | 'custom';

interface ReportsTabsProps {
    activeTab: ReportsTab;
    isAdvancedReportsEnabled: boolean;
    onChangeTab: (tab: ReportsTab) => void;
    onEnterCustomBuilder: () => void;
}

export function ReportsTabs({ activeTab, isAdvancedReportsEnabled, onChangeTab, onEnterCustomBuilder }: ReportsTabsProps) {
    const tabs: Array<{
        value: ReportsTab;
        label: string;
        description: string;
        icon: ReactNode;
        locked?: boolean;
        onClick: () => void;
    }> = [
        {
            value: 'overview',
            label: 'Overview',
            description: 'Revenue, products, customers',
            icon: <BarChart3 size={16} />,
            onClick: () => onChangeTab('overview')
        },
        {
            value: 'stock_velocity',
            label: 'Stock Velocity',
            description: 'Movement and reorder signals',
            icon: <Boxes size={16} />,
            onClick: () => onChangeTab('stock_velocity')
        },
        {
            value: 'profitability',
            label: 'Profitability',
            description: 'Margin and product performance',
            icon: <PieChart size={16} />,
            onClick: () => onChangeTab('profitability')
        },
        {
            value: 'premade',
            label: 'Report Library',
            description: 'Saved and system templates',
            icon: <Sparkles size={16} />,
            locked: !isAdvancedReportsEnabled,
            onClick: () => onChangeTab('premade')
        },
        {
            value: 'custom',
            label: 'Custom Builder',
            description: 'Build from any dimension',
            icon: <Wrench size={16} />,
            locked: !isAdvancedReportsEnabled,
            onClick: onEnterCustomBuilder
        }
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2 rounded-2xl border border-gray-200/70 bg-white/80 p-2 shadow-xs backdrop-blur-xs dark:border-slate-700 dark:bg-slate-900/70">
            {tabs.map((tab) => {
                const isActive = activeTab === tab.value;
                return (
                    <button
                        key={tab.value}
                        onClick={tab.onClick}
                        className={`group flex min-w-0 items-start gap-3 rounded-xl px-3 py-3 text-left transition-all ${isActive
                            ? 'bg-linear-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20'
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                            }`}
                    >
                        <span className={`mt-0.5 rounded-lg p-1.5 ${isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-400 group-hover:text-blue-600 dark:bg-slate-800'}`}>
                            {tab.icon}
                        </span>
                        <span className="min-w-0">
                            <span className="flex items-center gap-1.5 text-sm font-semibold">
                                {tab.label}
                                {tab.locked && <Lock size={12} className={isActive ? 'text-white/80' : 'text-gray-400'} />}
                            </span>
                            <span className={`mt-0.5 block truncate text-xs ${isActive ? 'text-blue-100' : 'text-gray-400 dark:text-slate-500'}`}>
                                {tab.description}
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
