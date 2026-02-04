/**
 * FlowNodes - Custom node components for the visual flow builder.
 * Each node type represents a different automation element: trigger, action, delay, condition.
 */
import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Clock, Split, Eye } from 'lucide-react';
import { NodeWrapper } from './NodeWrapper';
import {
    NodeStats, OnAddStepCallback, OnCopyNodeCallback, OnDeleteNodeCallback,
    getTriggerIcon, getTriggerLabel, getActionIcon, getActionLabel, getActionGradient
} from './flowNodeUtils';

/**
 * TriggerNode - Entry point for automation flows.
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
            <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white" />
        </>
    );
});

/**
 * ActionNode - Performs an action in the flow (send email, SMS, etc).
 */
export const ActionNode = memo(({ data, id }: NodeProps) => {
    const config = data.config as any;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;
    const onAddStep = data.onAddStep as OnAddStepCallback | undefined;
    const onCopy = data.onCopy as OnCopyNodeCallback | undefined;
    const onDelete = data.onDelete as OnDeleteNodeCallback | undefined;
    const isExitNode = config?.actionType === 'EXIT';

    return (
        <>
            <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white" />
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
                {config?.subject && <div className="text-xs text-gray-500 truncate mt-1 max-w-[200px]">{config.subject}</div>}
                {config?.actionType === 'SEND_EMAIL' && (
                    <button className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                        <Eye size={12} />View Analytics
                    </button>
                )}
            </NodeWrapper>
            {!isExitNode && <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-green-500 !border-2 !border-white" />}
        </>
    );
});

/**
 * DelayNode - Adds a time delay before the next step.
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
    let delayDescription = `Delay of ${duration} ${duration === 1 ? unit.slice(0, -1) : unit}.`;
    if (config?.delayUntilTime) delayDescription = `Wait until ${config.delayUntilTime}`;
    if (config?.delayUntilDays?.length > 0) delayDescription += ` on ${config.delayUntilDays.join(', ')}`;

    return (
        <>
            <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white" />
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
            <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-yellow-500 !border-2 !border-white" />
        </>
    );
});

/**
 * ConditionNode - Splits the flow based on a condition.
 */
export const ConditionNode = memo(({ data, id }: NodeProps) => {
    const config = data.config as any;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;
    const onAddStep = data.onAddStep as OnAddStepCallback | undefined;
    const onCopy = data.onCopy as OnCopyNodeCallback | undefined;
    const onDelete = data.onDelete as OnDeleteNodeCallback | undefined;

    const conditionPreview = config?.field && config?.operator && config?.value
        ? `${config.field} ${config.operator} ${config.value}`
        : 'Configure condition...';

    return (
        <>
            <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white" />
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
                    <div className="flex items-center gap-1"><span className="text-green-600">✓ YES</span></div>
                    <div className="flex items-center gap-1"><span className="text-red-600">✗ NO</span></div>
                </div>
            </NodeWrapper>
            <Handle type="source" position={Position.Bottom} id="true" className="!bg-green-500 !w-2.5 !h-2.5 !border-2 !border-white" style={{ left: '25%' }} />
            <Handle type="source" position={Position.Bottom} id="false" className="!bg-red-500 !w-2.5 !h-2.5 !border-2 !border-white" style={{ left: '75%' }} />
        </>
    );
});
