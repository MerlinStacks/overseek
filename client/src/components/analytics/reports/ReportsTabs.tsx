import { Lock } from 'lucide-react';

type ReportsTab = 'overview' | 'stock_velocity' | 'profitability' | 'premade' | 'custom';

interface ReportsTabsProps {
    activeTab: ReportsTab;
    isAdvancedReportsEnabled: boolean;
    onChangeTab: (tab: ReportsTab) => void;
    onEnterCustomBuilder: () => void;
}

export function ReportsTabs({ activeTab, isAdvancedReportsEnabled, onChangeTab, onEnterCustomBuilder }: ReportsTabsProps) {
    return (
        <div className="flex bg-white/80 backdrop-blur-xs p-1.5 rounded-xl border border-gray-200/60 shadow-xs">
            <button
                onClick={() => onChangeTab('overview')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'overview' ? 'bg-linear-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
            >
                Overview
            </button>
            <button
                onClick={() => onChangeTab('stock_velocity')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'stock_velocity' ? 'bg-linear-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
            >
                Stock Velocity
            </button>
            <button
                onClick={() => onChangeTab('profitability')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'profitability' ? 'bg-linear-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
            >
                Profitability
            </button>
            <button
                onClick={() => onChangeTab('premade')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'premade' ? 'bg-linear-to-r from-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/20' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
            >
                Report Library
            </button>
            <button
                onClick={onEnterCustomBuilder}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'custom' ? 'bg-linear-to-r from-green-500 to-green-600 text-white shadow-md shadow-green-500/20' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
            >
                Custom Builder
                {!isAdvancedReportsEnabled && <Lock size={12} className="ml-1 inline-block" />}
            </button>
        </div>
    );
}
