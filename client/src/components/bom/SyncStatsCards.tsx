/**
 * SyncStatsCards Component
 * 
 * Displays BOM sync statistics in card format.
 * Extracted from BOMSyncPage.tsx for reusability.
 */

import { Boxes, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import type { SyncStats } from '../../hooks/useBOMSync';

interface SyncStatsCardsProps {
    stats: SyncStats;
    errorCount: number;
    activeTab: 'pending' | 'all' | 'errors';
    onTabChange: (tab: 'pending' | 'all' | 'errors') => void;
}

export function SyncStatsCards({ stats, errorCount, activeTab, onTabChange }: SyncStatsCardsProps) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Total Products */}
            <button type="button" aria-pressed={activeTab === 'all'} onClick={() => onTabChange('all')}
                className={`text-left bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 ${activeTab === 'all' ? 'ring-2 ring-blue-400' : ''}`}>
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-300 mb-1">
                    <Boxes size={14} />
                    Total BOM Products
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
            </button>

            {/* Needs Sync */}
            <button
                type="button" aria-pressed={activeTab === 'pending'}
                onClick={() => onTabChange('pending')}
                className={`text-left rounded-xl border p-4 transition-all ${activeTab === 'pending'
                    ? 'bg-amber-100 border-amber-300 ring-2 ring-amber-200 dark:bg-amber-950 dark:border-amber-700 dark:ring-amber-800'
                    : 'bg-amber-50 border-amber-200 hover:bg-amber-100 dark:bg-amber-950/50 dark:border-amber-800 dark:hover:bg-amber-950'
                    }`}
            >
                <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 mb-1">
                    <AlertTriangle size={14} />
                    Needs Sync
                </div>
                <div className="text-2xl font-bold text-amber-800 dark:text-amber-200">{stats.needsSync}</div>
            </button>

            {/* In Sync */}
            <div className="text-left rounded-xl border p-4 bg-green-50 border-green-200 dark:bg-green-950/50 dark:border-green-800">
                <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300 mb-1">
                    <CheckCircle size={14} />
                    In Sync
                </div>
                <div className="text-2xl font-bold text-green-800 dark:text-green-200">{stats.inSync}</div>
            </div>

            {/* Errors */}
            <button
                type="button" aria-pressed={activeTab === 'errors'}
                onClick={() => onTabChange('errors')}
                className={`text-left rounded-xl border p-4 transition-all ${activeTab === 'errors'
                    ? 'bg-red-100 border-red-300 ring-2 ring-red-200 dark:bg-red-950 dark:border-red-700 dark:ring-red-800'
                    : errorCount > 0
                        ? 'bg-red-50 border-red-200 hover:bg-red-100 dark:bg-red-950/50 dark:border-red-800 dark:hover:bg-red-950'
                        : 'bg-gray-50 border-gray-200 dark:bg-slate-800 dark:border-slate-700'
                    }`}
            >
                <div className={`flex items-center gap-2 text-sm mb-1 ${errorCount > 0 ? 'text-red-700 dark:text-red-300' : 'text-gray-500 dark:text-slate-300'}`}>
                    <XCircle size={14} />
                    Errors
                </div>
                <div className={`text-2xl font-bold ${errorCount > 0 ? 'text-red-800 dark:text-red-200' : 'text-gray-400 dark:text-slate-400'}`}>
                    {errorCount}
                </div>
            </button>
        </div>
    );
}
