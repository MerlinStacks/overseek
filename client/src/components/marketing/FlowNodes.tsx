/**
 * FlowNodes - Custom node components for the visual flow builder.
 * Each node type represents a different automation element: trigger, action, delay, condition.
 */
import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Mail, Clock, Split, Zap, MessageSquare, Tag, Link, ShoppingCart, CheckCircle, Star, User } from 'lucide-react';

// Base wrapper for consistent node styling
interface NodeWrapperProps {
    children: React.ReactNode;
    title: string;
    icon: React.ReactNode;
    borderColor: string;
    bgColor?: string;
}

const NodeWrapper: React.FC<NodeWrapperProps> = ({ children, title, icon, borderColor, bgColor = 'bg-white' }) => (
    <div className={`shadow-lg rounded-lg border-2 ${borderColor} ${bgColor} min-w-[180px] max-w-[220px]`}>
        <div className={`flex items-center gap-2 px-3 py-2 border-b border-gray-100 rounded-t-lg`}>
            {icon}
            <span className="text-xs font-bold uppercase text-gray-600 tracking-wide">{title}</span>
        </div>
        <div className="p-3 text-sm text-gray-800">
            {children}
        </div>
    </div>
);

// Get icon for trigger type
const getTriggerIcon = (config: any) => {
    const triggerType = config?.triggerType;
    switch (triggerType) {
        case 'ORDER_CREATED':
            return <ShoppingCart size={14} className="text-blue-600" />;
        case 'ORDER_COMPLETED':
            return <CheckCircle size={14} className="text-blue-600" />;
        case 'REVIEW_LEFT':
            return <Star size={14} className="text-blue-600" />;
        case 'ABANDONED_CART':
            return <ShoppingCart size={14} className="text-blue-600" />;
        case 'MANUAL':
            return <User size={14} className="text-blue-600" />;
        default:
            return <Zap size={14} className="text-blue-600" />;
    }
};

// Get icon for action type
const getActionIcon = (config: any) => {
    const actionType = config?.actionType;
    switch (actionType) {
        case 'SEND_EMAIL':
            return <Mail size={14} className="text-green-600" />;
        case 'SEND_SMS':
            return <MessageSquare size={14} className="text-green-600" />;
        case 'ADD_TAG':
            return <Tag size={14} className="text-green-600" />;
        case 'WEBHOOK':
            return <Link size={14} className="text-green-600" />;
        default:
            return <Mail size={14} className="text-green-600" />;
    }
};

/**
 * TriggerNode - Entry point for automation flows.
 * Only has output handle (bottom) as it starts the flow.
 */
export const TriggerNode = memo(({ data }: NodeProps) => {
    const config = data.config as any;

    return (
        <NodeWrapper
            title="Trigger"
            icon={getTriggerIcon(config)}
            borderColor="border-blue-400"
            bgColor="bg-blue-50"
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

    return (
        <NodeWrapper
            title="Action"
            icon={getActionIcon(config)}
            borderColor="border-green-400"
            bgColor="bg-green-50"
        >
            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
            />
            <div className="font-semibold text-gray-900">{data.label as string}</div>
            {config?.subject && (
                <div className="text-xs text-gray-500 truncate mt-1">Subject: {config.subject}</div>
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
    const duration = config?.duration || 1;
    const unit = config?.unit || 'hours';

    return (
        <NodeWrapper
            title="Delay"
            icon={<Clock size={14} className="text-yellow-600" />}
            borderColor="border-yellow-400"
            bgColor="bg-yellow-50"
        >
            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
            />
            <div className="font-semibold text-gray-900">{data.label as string}</div>
            <div className="text-xs text-gray-500 mt-1">
                Wait {duration} {unit}
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
    return (
        <NodeWrapper
            title="Condition"
            icon={<Split size={14} className="text-orange-600" />}
            borderColor="border-orange-400"
            bgColor="bg-orange-50"
        >
            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
            />
            <div className="font-semibold text-gray-900 mb-2">{data.label as string}</div>

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
