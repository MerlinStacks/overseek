
import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Mail, Clock, Split, Zap, AlertCircle } from 'lucide-react';

const NodeWrapper = ({ children, title, icon: Icon, colorClass = "bg-white", borderClass = "border-gray-200" }: any) => (
    <div className={`shadow-md rounded-lg border-2 ${borderClass} ${colorClass} min-w-[200px]`}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-opacity-50">
            {Icon && <Icon size={16} className="text-gray-500" />}
            <span className="text-xs font-bold uppercase text-gray-600">{title}</span>
        </div>
        <div className="p-3 text-sm text-gray-800">
            {children}
        </div>
    </div>
);

export const TriggerNode = memo(({ data }: NodeProps) => {
    return (
        <NodeWrapper title="Trigger" icon={Zap} borderClass="border-blue-400">
            <div className="font-medium">{data.label}</div>
            <div className="text-xs text-gray-500 mt-1">{data.description || 'Starts the automation'}</div>
            <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-blue-500" />
        </NodeWrapper>
    );
});

export const ActionNode = memo(({ data }: NodeProps) => {
    return (
        <NodeWrapper title="Action" icon={Mail} borderClass="border-green-400">
            <Handle type="target" position={Position.Top} className="w-3 h-3 bg-gray-400" />
            <div className="font-medium">{data.label}</div>
            {data.config?.subject && <div className="text-xs text-gray-500 truncate mt-1">Subj: {data.config.subject}</div>}
            <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-green-500" />
        </NodeWrapper>
    );
});

export const DelayNode = memo(({ data }: NodeProps) => {
    return (
        <NodeWrapper title="Delay" icon={Clock} borderClass="border-yellow-400">
            <Handle type="target" position={Position.Top} className="w-3 h-3 bg-gray-400" />
            <div className="font-medium">{data.label}</div>
            <div className="text-xs text-gray-500 mt-1">Wait for specified time</div>
            <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-yellow-500" />
        </NodeWrapper>
    );
});

export const ConditionNode = memo(({ data }: NodeProps) => {
    return (
        <NodeWrapper title="Condition" icon={Split} borderClass="border-orange-400">
            <Handle type="target" position={Position.Top} className="w-3 h-3 bg-gray-400" />
            <div className="font-medium mb-2">{data.label}</div>

            <div className="flex justify-between items-center text-xs mt-2 font-semibold">
                <div className="relative">
                    <span className="text-green-600 mr-2">YES</span>
                    <Handle type="source" position={Position.Bottom} id="true" className="!bg-green-500 !left-2" style={{ left: '10px' }} />
                </div>
                <div className="relative">
                    <span className="text-red-600 ml-2">NO</span>
                    <Handle type="source" position={Position.Bottom} id="false" className="!bg-red-500 !right-2" style={{ left: 'auto', right: '10px' }} />
                </div>
            </div>
        </NodeWrapper>
    );
});
