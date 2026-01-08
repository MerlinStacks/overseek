/**
 * FlowNodes - Custom node components for the visual flow builder.
 * Each node type represents a different automation element: trigger, action, delay, condition.
 * 
 * Enhanced with:
 * - Step number badges for visual ordering
 * - Real-time enrollment statistics display
 * - Improved styling matching FluentCRM aesthetics
 */
import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import {
    Mail, Clock, Split, Zap, MessageSquare, Tag, Link, ShoppingCart,
    CheckCircle, Star, User, Eye, UserPlus, CreditCard, XCircle,
    MousePointer, Settings
} from 'lucide-react';

// Node statistics interface for enrollment counts
interface NodeStats {
    active: number;
    queued: number;
    completed: number;
    skipped?: number;
    failed?: number;
}

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
    onSettingsClick
}) => (
    <div className={`shadow-lg rounded-xl border-2 ${borderColor} ${bgColor} min-w-[200px] max-w-[260px] overflow-hidden`}>
        {/* Header with icon, step number, and title */}
        <div className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-100">
            {/* Colored icon background circle */}
            <div className={`w-8 h-8 rounded-lg ${iconBgColor} flex items-center justify-center flex-shrink-0`}>
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    {stepNumber !== undefined && (
                        <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded">
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
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                >
                    <Settings size={14} className="text-gray-400" />
                </button>
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
                        <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold">
                            {stats.active.toLocaleString()}
                        </span>
                    </div>
                )}
                {stats.queued > 0 && (
                    <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
                        <span className="text-yellow-600 font-medium">Queued</span>
                        <span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-bold">
                            {stats.queued.toLocaleString()}
                        </span>
                    </div>
                )}
                {stats.completed > 0 && (
                    <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                        <span className="text-green-600 font-medium">Completed</span>
                        <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">
                            {stats.completed.toLocaleString()}
                        </span>
                    </div>
                )}
            </div>
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
    };
    return labels[actionType] || 'Action';
};

/**
 * TriggerNode - Entry point for automation flows.
 * Only has output handle (bottom) as it starts the flow.
 * Includes settings button for automation-level configuration.
 */
export const TriggerNode = memo(({ data }: NodeProps) => {
    const config = data.config as any;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;

    return (
        <NodeWrapper
            title={getTriggerLabel(config)}
            subtitle="WooCommerce"
            icon={getTriggerIcon(config)}
            iconBgColor="bg-gradient-to-br from-blue-500 to-blue-600"
            borderColor="border-blue-300"
            bgColor="bg-white"
            stepNumber={stepNumber}
            stats={stats}
            onSettingsClick={data.onSettingsClick as (() => void) | undefined}
        >
            <div className="font-semibold text-gray-900">{data.label as string}</div>
            <div className="text-xs text-gray-500 mt-1">Starts the automation</div>
            <Handle
                type="source"
                position={Position.Bottom}
                className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white"
            />
        </NodeWrapper>
    );
});

/**
 * ActionNode - Performs an action in the flow (send email, SMS, etc).
 * Has both input (top) and output (bottom) handles.
 */
export const ActionNode = memo(({ data }: NodeProps) => {
    const config = data.config as any;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;

    return (
        <NodeWrapper
            title={getActionLabel(config)}
            subtitle="Email"
            icon={getActionIcon(config)}
            iconBgColor="bg-gradient-to-br from-green-500 to-green-600"
            borderColor="border-green-300"
            bgColor="bg-white"
            stepNumber={stepNumber}
            stats={stats}
        >
            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
            />
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
            <Handle
                type="source"
                position={Position.Bottom}
                className="!w-3 !h-3 !bg-green-500 !border-2 !border-white"
            />
        </NodeWrapper>
    );
});

/**
 * DelayNode - Adds a time delay before the next step.
 * Has both input (top) and output (bottom) handles.
 */
export const DelayNode = memo(({ data }: NodeProps) => {
    const config = data.config as any;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;

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
        <NodeWrapper
            title="Delay"
            subtitle="Delay for a specific period"
            icon={<Clock size={16} className="text-white" />}
            iconBgColor="bg-gradient-to-br from-yellow-500 to-orange-500"
            borderColor="border-yellow-300"
            bgColor="bg-white"
            stepNumber={stepNumber}
            stats={stats}
        >
            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
            />
            <div className="font-semibold text-gray-900">{data.label as string}</div>
            <div className="flex items-center gap-1 mt-2 px-2 py-1.5 bg-blue-50 rounded-lg border border-blue-100">
                <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                    <span className="text-white text-[10px]">i</span>
                </div>
                <span className="text-xs text-blue-700">{delayDescription}</span>
            </div>
            <Handle
                type="source"
                position={Position.Bottom}
                className="!w-3 !h-3 !bg-yellow-500 !border-2 !border-white"
            />
        </NodeWrapper>
    );
});

/**
 * ConditionNode - Splits the flow based on a condition.
 * Has input (top) and two outputs (YES/NO at bottom).
 */
export const ConditionNode = memo(({ data }: NodeProps) => {
    const config = data.config as any;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;

    // Build condition preview
    const conditionPreview = config?.field && config?.operator && config?.value
        ? `${config.field} ${config.operator} ${config.value}`
        : 'Configure condition...';

    return (
        <NodeWrapper
            title="Condition"
            subtitle="Split based on rules"
            icon={<Split size={16} className="text-white" />}
            iconBgColor="bg-gradient-to-br from-orange-500 to-red-500"
            borderColor="border-orange-300"
            bgColor="bg-white"
            stepNumber={stepNumber}
            stats={stats}
        >
            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
            />
            <div className="font-semibold text-gray-900 mb-2">{data.label as string}</div>
            <div className="text-xs text-gray-500 mb-3 truncate">{conditionPreview}</div>

            <div className="flex justify-between items-center text-xs font-semibold pt-2 border-t border-orange-200">
                <div className="relative flex items-center gap-1">
                    <span className="text-green-600">✓ YES</span>
                    <Handle
                        type="source"
                        position={Position.Bottom}
                        id="true"
                        className="!bg-green-500 !w-2.5 !h-2.5 !border-2 !border-white"
                        style={{ left: '25%' }}
                    />
                </div>
                <div className="relative flex items-center gap-1">
                    <span className="text-red-600">✗ NO</span>
                    <Handle
                        type="source"
                        position={Position.Bottom}
                        id="false"
                        className="!bg-red-500 !w-2.5 !h-2.5 !border-2 !border-white"
                        style={{ left: '75%' }}
                    />
                </div>
            </div>
        </NodeWrapper>
    );
});
