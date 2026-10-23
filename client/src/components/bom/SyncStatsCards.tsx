/**
 * SyncStatsCards Component
 * 
 * Compact BOM sync summary with interactive filter counters.
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
        <div aria-label="BOM sync summary and filters" className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-slate-200 py-2 dark:border-slate-700">
            {/* Total Products */}
            <button type="button" aria-pressed={activeTab === 'all'} onClick={() => onTabChange('all')}
                className={`flex min-h-11 items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--brand-subtle)] ${activeTab === 'all' ? 'bg-[var(--brand-subtle)] ring-1 ring-[var(--focus-color)]' : ''}`}>
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-300 mb-1">
                    <Boxes size={14} />
                    Total BOM Products
                </div>
                <div className="text-xl font-semibold tabular-nums text-gray-900 dark:text-white">{stats.total}</div>
            </button>

            {/* Needs Sync */}
            <button
                type="button" aria-pressed={activeTab === 'pending'}
                onClick={() => onTabChange('pending')}
                className={`flex min-h-11 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${activeTab === 'pending'
                    ? 'bg-amber-100 ring-1 ring-amber-300 dark:bg-amber-950 dark:ring-amber-700'
                    : 'hover:bg-amber-50 dark:hover:bg-amber-950'
                    }`}
            >
                <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 mb-1">
                    <AlertTriangle size={14} />
                    Needs Sync
                </div>
                <div className="text-xl font-semibold tabular-nums text-amber-800 dark:text-amber-200">{stats.needsSync}</div>
            </button>

            {/* In Sync */}
            <div className="flex min-h-11 items-center gap-2 px-2 py-2 text-left">
                <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300 mb-1">
                    <CheckCircle size={14} />
                    In Sync
                </div>
                <div className="text-xl font-semibold tabular-nums text-green-800 dark:text-green-200">{stats.inSync}</div>
            </div>

            {/* Errors */}
            <button
                type="button" aria-pressed={activeTab === 'errors'}
                onClick={() => onTabChange('errors')}
                className={`flex min-h-11 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${activeTab === 'errors'
                    ? 'bg-red-100 ring-1 ring-red-300 dark:bg-red-950 dark:ring-red-700'
                    : errorCount > 0
                        ? 'hover:bg-red-50 dark:hover:bg-red-950'
                        : 'hover:bg-gray-50 dark:hover:bg-slate-800'
                    }`}
            >
                <div className={`flex items-center gap-2 text-sm mb-1 ${errorCount > 0 ? 'text-red-700 dark:text-red-300' : 'text-gray-500 dark:text-slate-300'}`}>
                    <XCircle size={14} />
                    Errors
                </div>
                <div className={`text-xl font-semibold tabular-nums ${errorCount > 0 ? 'text-red-800 dark:text-red-200' : 'text-gray-400 dark:text-slate-400'}`}>
                    {errorCount}
                </div>
            </button>
        </div>
    );
}
