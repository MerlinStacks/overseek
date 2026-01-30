/**
 * FlowNodes - Custom node components for the visual flow builder.
 * Each node type represents a different automation element: trigger, action, delay, condition.
 * 
 * Enhanced with:
 * - Step number badges for visual ordering
 * - Real-time enrollment statistics display
 * - Interactive "+" buttons for adding steps (popup-driven workflow)
 * - Improved styling matching FluentCRM aesthetics
 */
import React, { memo, useCallback } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import {
    Mail, Clock, Split, Zap, MessageSquare, Tag, Link, ShoppingCart,
    CheckCircle, Star, User, Eye, UserPlus, CreditCard, XCircle,
    MousePointer, Settings, Plus, Target, ArrowUpDown, LogOut,
    MoreVertical, Copy, Move, Trash2
} from 'lucide-react';

// Node statistics interface for enrollment counts
interface NodeStats {
    active: number;
    queued: number;
    completed: number;
    skipped?: number;
    failed?: number;
}

// Add step button callback type
type OnAddStepCallback = (nodeId: string, position: { x: number; y: number }) => void;

// Add Step Button component - appears below nodes
interface AddStepButtonProps {
    nodeId: string;
    onAddStep?: OnAddStepCallback;
}

const AddStepButton: React.FC<AddStepButtonProps> = ({ nodeId, onAddStep }) => {
    const handleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (onAddStep) {
            // Get button position for popup placement
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            onAddStep(nodeId, {
                x: rect.left + rect.width / 2,
                y: rect.bottom,
            });
        }
    }, [nodeId, onAddStep]);

    if (!onAddStep) return null;

    return (
        <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center">
            {/* Connection line */}
            <div className="w-0.5 h-4 bg-gray-300" />
            {/* Plus button */}
            <button
                onClick={handleClick}
                className="w-6 h-6 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center shadow-md transition-all hover:scale-110"
            >
                <Plus size={14} />
            </button>
        </div>
    );
};

// Node action callbacks
type OnCopyNodeCallback = (nodeId: string) => void;
type OnMoveNodeCallback = (nodeId: string) => void;
type OnDeleteNodeCallback = (nodeId: string) => void;

// Node Action Menu - 3-dot dropdown for copy/move/delete
interface NodeActionMenuProps {
    nodeId: string;
    onCopy?: OnCopyNodeCallback;
    onMove?: OnMoveNodeCallback;
    onDelete?: OnDeleteNodeCallback;
}

const NodeActionMenu: React.FC<NodeActionMenuProps> = ({ nodeId, onCopy, onMove, onDelete }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const menuRef = React.useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    React.useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleAction = (action: () => void) => {
        setIsOpen(false);
        action();
    };

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
                className="p-1 hover:bg-gray-100 rounded-sm transition-colors"
            >
                <MoreVertical size={14} className="text-gray-400" />
            </button>
            {isOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 min-w-[120px]">
                    {onCopy && (
                        <button
                            onClick={(e) => { e.stopPropagation(); handleAction(() => onCopy(nodeId)); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                            <Copy size={14} />
                            Copy
                        </button>
                    )}
                    {onMove && (
                        <button
                            onClick={(e) => { e.stopPropagation(); handleAction(() => onMove(nodeId)); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                            <Move size={14} />
                            Move
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={(e) => { e.stopPropagation(); handleAction(() => onDelete(nodeId)); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                        >
                            <Trash2 size={14} />
                            Delete
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

// Base wrapper for consistent node styling with stats support
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

const NodeWrapper: React.FC<NodeWrapperProps> = ({
    children,
    title,
    subtitle,
    icon,
    iconBgColor,
    borderColor,
    bgColor = 'bg-white',
    stepNumber,
    stats,
    onSettingsClick,
    nodeId,
    onAddStep,
    showAddButton = true,
    onCopy,
    onMove,
    onDelete,
}) => (
    <div className="relative pb-8">
        <div className={`shadow-lg rounded-xl border-2 ${borderColor} ${bgColor} min-w-[200px] max-w-[260px] overflow-hidden`}>
            {/* Header with icon, step number, and title */}
            <div className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-100">
                {/* Colored icon background circle */}
                <div className={`w-8 h-8 rounded-lg ${iconBgColor} flex items-center justify-center shrink-0`}>
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        {stepNumber !== undefined && (
                            <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded-sm">
                                Step {stepNumber}
                            </span>
                        )}
                        <span className="text-xs font-bold uppercase text-gray-500 tracking-wide truncate">
                            {title}
                        </span>
                    </div>
                    {subtitle && (
                        <div className="text-[11px] text-gray-400 truncate mt-0.5">{subtitle}</div>
                    )}
                </div>
                {/* Settings button for trigger nodes */}
                {onSettingsClick && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onSettingsClick(); }}
                        className="p-1 hover:bg-gray-100 rounded-sm transition-colors"
                    >
                        <Settings size={14} className="text-gray-400" />
                    </button>
                )}
                {/* Action menu (copy/move/delete) */}
                {nodeId && (onCopy || onMove || onDelete) && (
                    <NodeActionMenu
                        nodeId={nodeId}
                        onCopy={onCopy}
                        onMove={onMove}
                        onDelete={onDelete}
                    />
                )}
            </div>

            {/* Content area */}
            <div className="p-3 text-sm text-gray-800">
                {children}
            </div>

            {/* Statistics bar */}
            {stats && (stats.active > 0 || stats.completed > 0 || stats.queued > 0) && (
                <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-t border-gray-100 text-[11px]">
                    {stats.active > 0 && (
                        <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                            <span className="text-purple-600 font-medium">Active</span>
                            <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-sm font-bold">
                                {stats.active.toLocaleString()}
                            </span>
                        </div>
                    )}
                    {stats.queued > 0 && (
                        <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
                            <span className="text-yellow-600 font-medium">Queued</span>
                            <span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-sm font-bold">
                                {stats.queued.toLocaleString()}
                            </span>
                        </div>
                    )}
                    {stats.completed > 0 && (
                        <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                            <span className="text-green-600 font-medium">Completed</span>
                            <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded-sm font-bold">
                                {stats.completed.toLocaleString()}
                            </span>
                        </div>
                    )}
                    {stats.failed && stats.failed > 0 && (
                        <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                            <span className="text-red-600 font-medium">Failed</span>
                            <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded-sm font-bold">
                                {stats.failed.toLocaleString()}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>

        {/* Add Step Button - below the node */}
        {showAddButton && nodeId && onAddStep && (
            <AddStepButton nodeId={nodeId} onAddStep={onAddStep} />
        )}
    </div>
);

// Get icon for trigger type
const getTriggerIcon = (config: any) => {
    const triggerType = config?.triggerType;
    switch (triggerType) {
        case 'ORDER_CREATED':
            return <ShoppingCart size={16} className="text-white" />;
        case 'ORDER_COMPLETED':
            return <CheckCircle size={16} className="text-white" />;
        case 'REVIEW_LEFT':
            return <Star size={16} className="text-white" />;
        case 'ABANDONED_CART':
            return <ShoppingCart size={16} className="text-white" />;
        case 'CART_VIEWED':
            return <Eye size={16} className="text-white" />;
        case 'CUSTOMER_SIGNUP':
            return <UserPlus size={16} className="text-white" />;
        case 'SUBSCRIPTION_CREATED':
            return <CreditCard size={16} className="text-white" />;
        case 'SUBSCRIPTION_CANCELLED':
            return <XCircle size={16} className="text-white" />;
        case 'TAG_ADDED':
        case 'TAG_REMOVED':
            return <Tag size={16} className="text-white" />;
        case 'EMAIL_OPENED':
            return <Mail size={16} className="text-white" />;
        case 'LINK_CLICKED':
            return <MousePointer size={16} className="text-white" />;
        case 'MANUAL':
            return <User size={16} className="text-white" />;
        default:
            return <Zap size={16} className="text-white" />;
    }
};

// Get human-readable trigger name
const getTriggerLabel = (config: any): string => {
    const triggerType = config?.triggerType;
    const labels: Record<string, string> = {
        'ORDER_CREATED': 'Order Created',
        'ORDER_COMPLETED': 'Order Completed',
        'REVIEW_LEFT': 'Review Left',
        'ABANDONED_CART': 'Cart Abandoned',
        'CART_VIEWED': 'Cart Viewed',
        'CUSTOMER_SIGNUP': 'Customer Signup',
        'SUBSCRIPTION_CREATED': 'Subscription Created',
        'SUBSCRIPTION_CANCELLED': 'Subscription Cancelled',
        'TAG_ADDED': 'Tag Added',
        'TAG_REMOVED': 'Tag Removed',
        'EMAIL_OPENED': 'Email Opened',
        'LINK_CLICKED': 'Link Clicked',
        'MANUAL': 'Manual Entry',
    };
    return labels[triggerType] || 'Trigger';
};

// Get icon for action type
const getActionIcon = (config: any) => {
    const actionType = config?.actionType;
    switch (actionType) {
        case 'SEND_EMAIL':
            return <Mail size={16} className="text-white" />;
        case 'SEND_SMS':
            return <MessageSquare size={16} className="text-white" />;
        case 'ADD_TAG':
        case 'REMOVE_TAG':
            return <Tag size={16} className="text-white" />;
        case 'WEBHOOK':
            return <Link size={16} className="text-white" />;
        case 'GOAL':
            return <Target size={16} className="text-white" />;
        case 'JUMP':
            return <ArrowUpDown size={16} className="text-white" />;
        case 'EXIT':
            return <LogOut size={16} className="text-white" />;
        default:
            return <Mail size={16} className="text-white" />;
    }
};

// Get human-readable action name
const getActionLabel = (config: any): string => {
    const actionType = config?.actionType;
    const labels: Record<string, string> = {
        'SEND_EMAIL': 'Send Email',
        'SEND_SMS': 'Send SMS',
        'ADD_TAG': 'Add Tag',
        'REMOVE_TAG': 'Remove Tag',
        'WEBHOOK': 'Webhook',
        'GOAL': 'Goal',
        'JUMP': 'Jump',
        'EXIT': 'Exit',
    };
    return labels[actionType] || 'Action';
};

// Get gradient color for action type
const getActionGradient = (config: any): string => {
    const actionType = config?.actionType;
    switch (actionType) {
        case 'GOAL':
            return 'bg-linear-to-br from-emerald-500 to-emerald-600';
        case 'JUMP':
            return 'bg-linear-to-br from-red-500 to-red-600';
        case 'EXIT':
            return 'bg-linear-to-br from-gray-500 to-gray-600';
        default:
            return 'bg-linear-to-br from-green-500 to-green-600';
    }
};

/**
 * TriggerNode - Entry point for automation flows.
 * Only has output handle (bottom) as it starts the flow.
 * Includes settings button for automation-level configuration.
 */
export const TriggerNode = memo(({ data, id }: NodeProps) => {
    const config = data.config as any;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;
    const onAddStep = data.onAddStep as OnAddStepCallback | undefined;
    const onCopy = data.onCopy as OnCopyNodeCallback | undefined;
    const onDelete = data.onDelete as OnDeleteNodeCallback | undefined;

    return (
        <>
            <NodeWrapper
                title={getTriggerLabel(config)}
                subtitle="WooCommerce"
                icon={getTriggerIcon(config)}
                iconBgColor="bg-linear-to-br from-blue-500 to-blue-600"
                borderColor="border-blue-300"
                bgColor="bg-white"
                stepNumber={stepNumber}
                stats={stats}
                onSettingsClick={data.onSettingsClick as (() => void) | undefined}
                nodeId={id}
                onAddStep={onAddStep}
                onCopy={onCopy}
                onDelete={onDelete}
            >
                <div className="font-semibold text-gray-900">{data.label as string}</div>
                <div className="text-xs text-gray-500 mt-1">Starts the automation</div>
            </NodeWrapper>
            <Handle
                type="source"
                position={Position.Bottom}
                className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white"
            />
        </>
    );
});

/**
 * ActionNode - Performs an action in the flow (send email, SMS, etc).
 * Has both input (top) and output (bottom) handles.
 */
export const ActionNode = memo(({ data, id }: NodeProps) => {
    const config = data.config as any;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;
    const onAddStep = data.onAddStep as OnAddStepCallback | undefined;
    const onCopy = data.onCopy as OnCopyNodeCallback | undefined;
    const onDelete = data.onDelete as OnDeleteNodeCallback | undefined;

    // Exit nodes shouldn't have add button
    const isExitNode = config?.actionType === 'EXIT';

    return (
        <>
            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
            />
            <NodeWrapper
                title={getActionLabel(config)}
                subtitle={config?.actionType === 'SEND_EMAIL' ? 'Email' : undefined}
                icon={getActionIcon(config)}
                iconBgColor={getActionGradient(config)}
                borderColor="border-green-300"
                bgColor="bg-white"
                stepNumber={stepNumber}
                stats={stats}
                nodeId={id}
                onAddStep={onAddStep}
                showAddButton={!isExitNode}
                onCopy={onCopy}
                onDelete={onDelete}
            >
                <div className="font-semibold text-gray-900">{data.label as string}</div>
                {config?.subject && (
                    <div className="text-xs text-gray-500 truncate mt-1 max-w-[200px]">
                        {config.subject}
                    </div>
                )}
                {config?.actionType === 'SEND_EMAIL' && (
                    <button className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                        <Eye size={12} /> View Analytics
                    </button>
                )}
            </NodeWrapper>
            {!isExitNode && (
                <Handle
                    type="source"
                    position={Position.Bottom}
                    className="!w-3 !h-3 !bg-green-500 !border-2 !border-white"
                />
            )}
        </>
    );
});

/**
 * DelayNode - Adds a time delay before the next step.
 * Has both input (top) and output (bottom) handles.
 */
export const DelayNode = memo(({ data, id }: NodeProps) => {
    const config = data.config as any;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;
    const onAddStep = data.onAddStep as OnAddStepCallback | undefined;
    const onCopy = data.onCopy as OnCopyNodeCallback | undefined;
    const onDelete = data.onDelete as OnDeleteNodeCallback | undefined;

    const duration = config?.duration || 1;
    const unit = config?.unit || 'hours';

    // Build delay description
    let delayDescription = `Delay of ${duration} ${duration === 1 ? unit.slice(0, -1) : unit}.`;
    if (config?.delayUntilTime) {
        delayDescription = `Wait until ${config.delayUntilTime}`;
    }
    if (config?.delayUntilDays?.length > 0) {
        delayDescription += ` on ${config.delayUntilDays.join(', ')}`;
    }

    return (
        <>
            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
            />
            <NodeWrapper
                title="Delay"
                subtitle="Delay for a specific period"
                icon={<Clock size={16} className="text-white" />}
                iconBgColor="bg-linear-to-br from-yellow-500 to-orange-500"
                borderColor="border-yellow-300"
                bgColor="bg-white"
                stepNumber={stepNumber}
                stats={stats}
                nodeId={id}
                onAddStep={onAddStep}
                onCopy={onCopy}
                onDelete={onDelete}
            >
                <div className="font-semibold text-gray-900">{data.label as string}</div>
                <div className="flex items-center gap-1 mt-2 px-2 py-1.5 bg-blue-50 rounded-lg border border-blue-100">
                    <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                        <span className="text-white text-[10px]">i</span>
                    </div>
                    <span className="text-xs text-blue-700">{delayDescription}</span>
                </div>
            </NodeWrapper>
            <Handle
                type="source"
                position={Position.Bottom}
                className="!w-3 !h-3 !bg-yellow-500 !border-2 !border-white"
            />
        </>
    );
});

/**
 * ConditionNode - Splits the flow based on a condition.
 * Has input (top) and two outputs (YES/NO at bottom).
 */
export const ConditionNode = memo(({ data, id }: NodeProps) => {
    const config = data.config as any;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;
    const onAddStep = data.onAddStep as OnAddStepCallback | undefined;
    const onCopy = data.onCopy as OnCopyNodeCallback | undefined;
    const onDelete = data.onDelete as OnDeleteNodeCallback | undefined;

    // Build condition preview
    const conditionPreview = config?.field && config?.operator && config?.value
        ? `${config.field} ${config.operator} ${config.value}`
        : 'Configure condition...';

    return (
        <>
            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
            />
            <NodeWrapper
                title="Condition"
                subtitle="Split based on rules"
                icon={<Split size={16} className="text-white" />}
                iconBgColor="bg-linear-to-br from-orange-500 to-red-500"
                borderColor="border-orange-300"
                bgColor="bg-white"
                stepNumber={stepNumber}
                stats={stats}
                nodeId={id}
                onAddStep={onAddStep}
                showAddButton={false}
                onCopy={onCopy}
                onDelete={onDelete}
            >
                <div className="font-semibold text-gray-900 mb-2">{data.label as string}</div>
                <div className="text-xs text-gray-500 mb-3 truncate">{conditionPreview}</div>

                <div className="flex justify-between items-center text-xs font-semibold pt-2 border-t border-orange-200">
                    <div className="relative flex items-center gap-1">
                        <span className="text-green-600">✓ YES</span>
                    </div>
                    <div className="relative flex items-center gap-1">
                        <span className="text-red-600">✗ NO</span>
                    </div>
                </div>
            </NodeWrapper>
            <Handle
                type="source"
                position={Position.Bottom}
                id="true"
                className="!bg-green-500 !w-2.5 !h-2.5 !border-2 !border-white"
                style={{ left: '25%' }}
            />
            <Handle
                type="source"
                position={Position.Bottom}
                id="false"
                className="!bg-red-500 !w-2.5 !h-2.5 !border-2 !border-white"
                style={{ left: '75%' }}
            />
        </>
    );
});
