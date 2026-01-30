import { X, Loader2 } from 'lucide-react';
import { useSyncStatus } from '../../context/SyncStatusContext';
import { cn } from '../../utils/cn';

interface SyncProgressOverlayProps {
    collapsed: boolean;
}

export function SyncProgressOverlay({ collapsed }: SyncProgressOverlayProps) {
    const { activeJobs, controlSync } = useSyncStatus();

    if (activeJobs.length === 0) return null;

    // Just show the first job for now if multiple, or map them
    // For sidebar bottom, space is limited. Let's stack them or just show overall "Syncing..."
    // Let's show a list if expanded, or just a small circle if collapsed.

    return (
        <div className={cn(
            "border-t border-gray-100 bg-gray-50",
            collapsed ? "p-2 items-center flex flex-col" : "p-4"
        )}>
            {collapsed ? (
                <div className="relative group">
                    <div className="h-8 w-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-blue-600">
                        {Math.round(activeJobs[0].progress || 0)}%
                    </div>
                    {/* Tooltip */}
                    <div className="absolute left-full ml-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-sm opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none min-w-[150px]">
                        {activeJobs.map(job => (
                            <div key={job.id} className="mb-1 last:mb-0">
                                {job.queue.replace('sync-', '')}: {job.progress}%
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sync in Progress</span>
                        {/* Global Cancel? Or per, let's allow cancel all? Or just active one? */}
                        {/* For simplicity, cancel the first one or we need a cancel button per job */}
                    </div>

                    <div className="space-y-2">
                        {activeJobs.map((job) => (
                            <div key={job.id} className="bg-white p-2 rounded-sm border border-gray-200 shadow-xs relative overflow-hidden group">
                                <div className="flex items-center justify-between mb-1 relative z-10">
                                    <div className="flex items-center gap-2">
                                        <Loader2 size={14} className="animate-spin text-blue-500" />
                                        <span className="text-xs font-medium capitalize text-gray-700">
                                            {job.queue.replace('sync-', '')}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-500 font-mono">{job.progress}%</span>
                                        <button
                                            onClick={() => controlSync('cancel', job.queue, job.id)}
                                            className="text-gray-400 hover:text-red-500 transition-colors p-0.5"
                                            title="Cancel Sync"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                </div>

                                {/* Progress Bar Background */}
                                <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                                    <div
                                        className="bg-blue-500 h-full transition-all duration-300 rounded-full"
                                        style={{ width: `${job.progress}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
