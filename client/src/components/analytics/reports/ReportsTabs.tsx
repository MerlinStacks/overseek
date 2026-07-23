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
        icon: typeof BarChart3;
        locked?: boolean;
        onClick: () => void;
    }> = [
        {
            value: 'overview',
            label: 'Overview',
            icon: BarChart3,
            onClick: () => onChangeTab('overview')
        },
        {
            value: 'stock_velocity',
            label: 'Stock Velocity',
            icon: Boxes,
            onClick: () => onChangeTab('stock_velocity')
        },
        {
            value: 'profitability',
            label: 'Profitability',
            icon: PieChart,
            onClick: () => onChangeTab('profitability')
        },
        {
            value: 'premade',
            label: 'Report Library',
            icon: Sparkles,
            locked: !isAdvancedReportsEnabled,
            onClick: () => onChangeTab('premade')
        },
        {
            value: 'custom',
            label: 'Custom Builder',
            icon: Wrench,
            locked: !isAdvancedReportsEnabled,
            onClick: onEnterCustomBuilder
        }
    ];

    return (
        <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-gray-100/80 p-1 dark:bg-slate-800">
            {tabs.map((tab) => {
                const isActive = activeTab === tab.value;
                const Icon = tab.icon;
                return (
                    <button
                        key={tab.value}
                        onClick={tab.onClick}
                        className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all ${isActive
                            ? 'bg-white text-gray-900 shadow-xs dark:bg-slate-700 dark:text-white'
                            : 'text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'
                            }`}
                    >
                        <Icon size={16} />
                        <span>{tab.label}</span>
                        {tab.locked && <Lock size={12} className="text-gray-400 dark:text-slate-500" />}
                    </button>
                );
            })}
        </div>
    );
}
