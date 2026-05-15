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
            <div className="w-0.5 h-4 bg-gray-300" />
            <button onClick={handleClick} className="w-6 h-6 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center shadow-md transition-all hover:scale-110">
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
            <button onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }} className="p-1 hover:bg-gray-100 rounded-sm transition-colors">
                <MoreVertical size={14} className="text-gray-400" />
            </button>
            {isOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 min-w-[120px]">
                    {onCopy && <button onClick={(e) => { e.stopPropagation(); handleAction(() => onCopy(nodeId)); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Copy size={14} />Copy</button>}
                    {onMove && <button onClick={(e) => { e.stopPropagation(); handleAction(() => onMove(nodeId)); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Move size={14} />Move</button>}
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
}

export const NodeWrapper: React.FC<NodeWrapperProps> = ({
    children, title, subtitle, icon, iconBgColor, borderColor, bgColor = 'bg-white',
    stepNumber, stats, onSettingsClick, nodeId, onAddStep, showAddButton = true, onCopy, onMove, onDelete, statOrder
}) => (
    <div className="relative pb-8">
        <div className={`shadow-lg rounded-xl border ${borderColor} ${bgColor} min-w-[220px] max-w-[280px] overflow-hidden`}>
            <div className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-100">
                <div className={`w-8 h-8 rounded-lg ${iconBgColor} flex items-center justify-center shrink-0`}>{icon}</div>
                <div className="flex-1 min-w-0">
                    {stepNumber !== undefined && <div className="text-[11px] text-gray-400 leading-none mb-0.5">Step {stepNumber}</div>}
                    <div className="text-[30px] leading-tight font-semibold text-gray-900 truncate">{title}</div>
                    {subtitle && <div className="text-[11px] text-gray-500 truncate mt-0.5">{subtitle}</div>}
                </div>
                {onSettingsClick && <button onClick={(e) => { e.stopPropagation(); onSettingsClick(); }} className="p-1 hover:bg-gray-100 rounded-sm transition-colors"><Settings size={14} className="text-gray-400" /></button>}
                {nodeId && (onCopy || onMove || onDelete) && <NodeActionMenu nodeId={nodeId} onCopy={onCopy} onMove={onMove} onDelete={onDelete} />}
            </div>
            <div className="p-3 text-sm text-gray-800">{children}</div>
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
                    .map((key) => ({ key, ...meta[key] }))
                    .filter((entry) => entry.value > 0);

                if (visibleStats.length === 0) return null;

                return (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 bg-slate-100 border-t border-slate-200 text-[11px]">
                        {visibleStats.map((entry) => (
                            <div key={entry.key} className="flex items-center gap-1">
                                <span className="text-slate-700">{entry.label}</span>
                                <span className={`px-2 py-0.5 rounded-full border font-semibold ${entry.badgeClass}`}>{entry.value.toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                );
            })()}
        </div>
        {showAddButton && nodeId && onAddStep && <AddStepButton nodeId={nodeId} onAddStep={onAddStep} />}
    </div>
);
