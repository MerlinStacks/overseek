/**
 * NodeWrapper
 * 
 * Base wrapper for consistent flow node styling with stats support.
 */
import React, { useCallback } from 'react';
import { Settings, Plus, MoreVertical, Copy, Move, Trash2 } from 'lucide-react';
import { NodeStats, OnAddStepCallback, OnCopyNodeCallback, OnMoveNodeCallback, OnDeleteNodeCallback } from './flowNodeUtils';

interface AddStepButtonProps {
    nodeId: string;
    onAddStep?: OnAddStepCallback;
}

export const AddStepButton: React.FC<AddStepButtonProps> = ({ nodeId, onAddStep }) => {
    const handleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (onAddStep) {
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            onAddStep(nodeId, { x: rect.left + rect.width / 2, y: rect.bottom });
        }
    }, [nodeId, onAddStep]);

    if (!onAddStep) return null;

    return (
        <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center">
            <div className="w-0.5 h-4 bg-slate-300" />
            <button onClick={handleClick} className="w-7 h-7 rounded-full bg-linear-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white flex items-center justify-center shadow-lg shadow-blue-300/40 transition-all hover:scale-110">
                <Plus size={14} />
            </button>
        </div>
    );
};

interface NodeActionMenuProps {
    nodeId: string;
    onCopy?: OnCopyNodeCallback;
    onMove?: OnMoveNodeCallback;
    onDelete?: OnDeleteNodeCallback;
}

export const NodeActionMenu: React.FC<NodeActionMenuProps> = ({ nodeId, onCopy, onMove, onDelete }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const menuRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleAction = (action: () => void) => { setIsOpen(false); action(); };

    return (
        <div className="relative" ref={menuRef}>
            <button onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }} className="p-1.5 hover:bg-slate-100 rounded-md transition-colors">
                <MoreVertical size={14} className="text-slate-500" />
            </button>
            {isOpen && (
                <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-lg shadow-xl shadow-slate-900/10 z-50 py-1 min-w-[130px]">
                    {onCopy && <button onClick={(e) => { e.stopPropagation(); handleAction(() => onCopy(nodeId)); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Copy size={14} />Copy</button>}
                    {onMove && <button onClick={(e) => { e.stopPropagation(); handleAction(() => onMove(nodeId)); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Move size={14} />Move</button>}
                    {onDelete && <button onClick={(e) => { e.stopPropagation(); handleAction(() => onDelete(nodeId)); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"><Trash2 size={14} />Delete</button>}
                </div>
            )}
        </div>
    );
};

interface NodeWrapperProps {
    children: React.ReactNode;
    title: string;
    subtitle?: string;
    icon: React.ReactNode;
    iconBgColor: string;
    borderColor: string;
    bgColor?: string;
    stepNumber?: number;
    stats?: NodeStats;
    onSettingsClick?: () => void;
    nodeId?: string;
    onAddStep?: OnAddStepCallback;
    showAddButton?: boolean;
    onCopy?: OnCopyNodeCallback;
    onMove?: OnMoveNodeCallback;
    onDelete?: OnDeleteNodeCallback;
    statOrder?: Array<'active' | 'queued' | 'completed' | 'skipped' | 'failed'>;
    onStatsClick?: () => void;
    density?: 'compact' | 'comfortable';
}

export const NodeWrapper: React.FC<NodeWrapperProps> = ({
    children, title, subtitle, icon, iconBgColor, borderColor, bgColor = 'bg-white',
    stepNumber, stats, onSettingsClick, nodeId, onAddStep, showAddButton = true, onCopy, onMove, onDelete, statOrder, onStatsClick, density = 'comfortable'
}) => {
    const isCompact = density === 'compact';

    return (
    <div className="relative mb-8">
        <div className={`rounded-2xl border ${borderColor} ${bgColor} ${isCompact ? 'min-w-[210px] max-w-[270px]' : 'min-w-[240px] max-w-[320px]'} overflow-hidden shadow-xl shadow-slate-900/8 ring-1 ring-slate-900/5 transition-shadow hover:shadow-2xl hover:shadow-slate-900/12`}>
            <div className={`flex items-center gap-3 ${isCompact ? 'px-3 py-2.5' : 'px-4 py-3'} border-b border-slate-100 bg-linear-to-r from-slate-50/80 to-white`}>
                <div className={`${isCompact ? 'w-8 h-8 rounded-lg' : 'w-9 h-9 rounded-xl'} ${iconBgColor} flex items-center justify-center shrink-0 shadow-md shadow-slate-900/10`}>{icon}</div>
                <div className="flex-1 min-w-0">
                    {stepNumber !== undefined && <div className={`text-[11px] text-slate-400 leading-none uppercase tracking-wide ${isCompact ? 'mb-0.5' : 'mb-1'}`}>Step {stepNumber}</div>}
                    <div className={`${isCompact ? 'text-[15px]' : 'text-base'} leading-tight font-semibold text-slate-900 truncate`}>{title}</div>
                    {subtitle && <div className={`text-xs text-slate-500 truncate ${isCompact ? 'mt-0.5' : 'mt-1'}`}>{subtitle}</div>}
                </div>
                {onSettingsClick && <button onClick={(e) => { e.stopPropagation(); onSettingsClick(); }} className="p-1.5 hover:bg-slate-100 rounded-md transition-colors"><Settings size={14} className="text-slate-500" /></button>}
                {nodeId && (onCopy || onMove || onDelete) && <NodeActionMenu nodeId={nodeId} onCopy={onCopy} onMove={onMove} onDelete={onDelete} />}
            </div>
            <div className={`${isCompact ? 'px-3 py-2.5 text-[13px]' : 'px-4 py-3 text-sm'} text-slate-800`}>{children}</div>
            {stats && (() => {
                const defaultOrder: Array<'active' | 'queued' | 'completed' | 'skipped' | 'failed'> = ['active', 'queued', 'completed', 'skipped', 'failed'];
                const order = statOrder && statOrder.length > 0 ? statOrder : defaultOrder;
                const meta: Record<'active' | 'queued' | 'completed' | 'skipped' | 'failed', { label: string; value: number; badgeClass: string }> = {
                    active: { label: 'Active', value: stats.active ?? 0, badgeClass: 'bg-teal-100 text-teal-700 border-teal-200' },
                    queued: { label: 'Queued', value: stats.queued ?? 0, badgeClass: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
                    completed: { label: 'Completed', value: stats.completed ?? 0, badgeClass: 'bg-sky-100 text-sky-700 border-sky-200' },
                    skipped: { label: 'Skipped', value: stats.skipped ?? 0, badgeClass: 'bg-amber-100 text-amber-700 border-amber-200' },
                    failed: { label: 'Failed', value: stats.failed ?? 0, badgeClass: 'bg-red-100 text-red-700 border-red-200' },
                };
                const visibleStats = order
                    .map((key) => ({ key, ...meta[key] }));

                if (visibleStats.length === 0) return null;

                return (
                    onStatsClick ? (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onStatsClick();
                            }}
                            className={`w-full flex flex-wrap items-center gap-x-3 gap-y-1 text-left ${isCompact ? 'px-3 py-2' : 'px-4 py-2.5'} bg-slate-50 border-t border-slate-200 text-[11px] cursor-pointer hover:bg-slate-100 transition-colors`}
                        >
                            {visibleStats.map((entry) => (
                                <div key={entry.key} className="flex items-center gap-1">
                                    <span className="text-slate-700">{entry.label}</span>
                                    <span className={`px-2 py-0.5 rounded-full border font-semibold ${entry.badgeClass}`}>{entry.value.toLocaleString()}</span>
                                </div>
                            ))}
                        </button>
                    ) : (
                        <div className={`w-full flex flex-wrap items-center gap-x-3 gap-y-1 ${isCompact ? 'px-3 py-2' : 'px-4 py-2.5'} bg-slate-50 border-t border-slate-200 text-[11px]`}>
                            {visibleStats.map((entry) => (
                                <div key={entry.key} className="flex items-center gap-1">
                                    <span className="text-slate-700">{entry.label}</span>
                                    <span className={`px-2 py-0.5 rounded-full border font-semibold ${entry.badgeClass}`}>{entry.value.toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    )
                );
            })()}
        </div>
        {showAddButton && nodeId && onAddStep && <AddStepButton nodeId={nodeId} onAddStep={onAddStep} />}
    </div>
    );
};
