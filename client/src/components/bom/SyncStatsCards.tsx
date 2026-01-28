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
        <div className="grid grid-cols-4 gap-4">
            {/* Total Products */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                    <Boxes size={14} />
                    Total BOM Products
                </div>
                <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            </div>

            {/* Needs Sync */}
            <button
                onClick={() => onTabChange('pending')}
                className={`text-left rounded-xl border p-4 transition-all ${activeTab === 'pending'
                    ? 'bg-amber-100 border-amber-300 ring-2 ring-amber-200'
                    : 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                    }`}
            >
                <div className="flex items-center gap-2 text-sm text-amber-700 mb-1">
                    <AlertTriangle size={14} />
                    Needs Sync
                </div>
                <div className="text-2xl font-bold text-amber-800">{stats.needsSync}</div>
            </button>

            {/* In Sync */}
            <button
                onClick={() => onTabChange('all')}
                className={`text-left rounded-xl border p-4 transition-all ${activeTab === 'all'
                    ? 'bg-green-100 border-green-300 ring-2 ring-green-200'
                    : 'bg-green-50 border-green-200 hover:bg-green-100'
                    }`}
            >
                <div className="flex items-center gap-2 text-sm text-green-700 mb-1">
                    <CheckCircle size={14} />
                    In Sync
                </div>
                <div className="text-2xl font-bold text-green-800">{stats.inSync}</div>
            </button>

            {/* Errors */}
            <button
                onClick={() => onTabChange('errors')}
                className={`text-left rounded-xl border p-4 transition-all ${activeTab === 'errors'
                    ? 'bg-red-100 border-red-300 ring-2 ring-red-200'
                    : errorCount > 0
                        ? 'bg-red-50 border-red-200 hover:bg-red-100'
                        : 'bg-gray-50 border-gray-200'
                    }`}
            >
                <div className={`flex items-center gap-2 text-sm mb-1 ${errorCount > 0 ? 'text-red-700' : 'text-gray-500'}`}>
                    <XCircle size={14} />
                    Errors
                </div>
                <div className={`text-2xl font-bold ${errorCount > 0 ? 'text-red-800' : 'text-gray-400'}`}>
                    {errorCount}
                </div>
            </button>
        </div>
    );
}
