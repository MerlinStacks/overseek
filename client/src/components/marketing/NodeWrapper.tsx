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
}

export const NodeWrapper: React.FC<NodeWrapperProps> = ({
    children, title, subtitle, icon, iconBgColor, borderColor, bgColor = 'bg-white',
    stepNumber, stats, onSettingsClick, nodeId, onAddStep, showAddButton = true, onCopy, onMove, onDelete
}) => (
    <div className="relative pb-8">
        <div className={`shadow-lg rounded-xl border-2 ${borderColor} ${bgColor} min-w-[200px] max-w-[260px] overflow-hidden`}>
            <div className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-100">
                <div className={`w-8 h-8 rounded-lg ${iconBgColor} flex items-center justify-center shrink-0`}>{icon}</div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        {stepNumber !== undefined && <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded-sm">Step {stepNumber}</span>}
                        <span className="text-xs font-bold uppercase text-gray-500 tracking-wide truncate">{title}</span>
                    </div>
                    {subtitle && <div className="text-[11px] text-gray-400 truncate mt-0.5">{subtitle}</div>}
                </div>
                {onSettingsClick && <button onClick={(e) => { e.stopPropagation(); onSettingsClick(); }} className="p-1 hover:bg-gray-100 rounded-sm transition-colors"><Settings size={14} className="text-gray-400" /></button>}
                {nodeId && (onCopy || onMove || onDelete) && <NodeActionMenu nodeId={nodeId} onCopy={onCopy} onMove={onMove} onDelete={onDelete} />}
            </div>
            <div className="p-3 text-sm text-gray-800">{children}</div>
            {stats && (stats.active > 0 || stats.completed > 0 || stats.queued > 0) && (
                <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-t border-gray-100 text-[11px]">
                    {stats.active > 0 && <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span><span className="text-purple-600 font-medium">Active</span><span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-sm font-bold">{stats.active.toLocaleString()}</span></div>}
                    {stats.queued > 0 && <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span><span className="text-yellow-600 font-medium">Queued</span><span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-sm font-bold">{stats.queued.toLocaleString()}</span></div>}
                    {stats.completed > 0 && <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span><span className="text-green-600 font-medium">Completed</span><span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded-sm font-bold">{stats.completed.toLocaleString()}</span></div>}
                    {stats.failed && stats.failed > 0 && <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500"></span><span className="text-red-600 font-medium">Failed</span><span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded-sm font-bold">{stats.failed.toLocaleString()}</span></div>}
                </div>
            )}
        </div>
        {showAddButton && nodeId && onAddStep && <AddStepButton nodeId={nodeId} onAddStep={onAddStep} />}
    </div>
);
