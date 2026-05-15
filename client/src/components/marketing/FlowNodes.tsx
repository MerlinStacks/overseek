/**
 * FlowNodes - Custom node components for the visual flow builder.
 * Each node type represents a different automation element: trigger, action, delay, condition.
 */
import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Clock, Split, Eye } from 'lucide-react';
import { NodeWrapper } from './NodeWrapper';
import {
    NodeStats, OnAddStepCallback, OnCopyNodeCallback, OnDeleteNodeCallback,
    getTriggerIcon, getTriggerLabel, getActionIcon, getActionLabel, getActionGradient
} from './flowNodeUtils';

interface FlowNodeConfig {
    actionType?: string;
    subject?: string;
    duration?: number;
    unit?: string;
    delayUntilTime?: string;
    delayUntilDays?: string[];
    field?: string;
    operator?: string;
    value?: string;
    conditions?: Array<{ field?: string; operator?: string; value?: string }>;
}

interface FlowNodeData {
    label?: string;
    config?: FlowNodeConfig;
    stats?: NodeStats;
    stepNumber?: number;
    onAddStep?: OnAddStepCallback;
    onCopy?: OnCopyNodeCallback;
    onDelete?: OnDeleteNodeCallback;
    onSettingsClick?: () => void;
    density?: 'compact' | 'comfortable';
}

/**
 * TriggerNode - Entry point for automation flows.
 */
export const TriggerNode = memo(({ data, id }: NodeProps) => {
    const nodeData = data as unknown as FlowNodeData;
    const config = nodeData.config;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;
    const onAddStep = data.onAddStep as OnAddStepCallback | undefined;
    const onCopy = data.onCopy as OnCopyNodeCallback | undefined;
    const onDelete = data.onDelete as OnDeleteNodeCallback | undefined;
    const density = nodeData.density ?? 'comfortable';
    const triggerLabel = getTriggerLabel(config);

    return (
        <>
            <NodeWrapper
                title={triggerLabel}
                subtitle="WooCommerce"
                icon={getTriggerIcon(config)}
                iconBgColor="bg-linear-to-br from-blue-500 to-blue-600"
                borderColor="border-blue-200"
                bgColor="bg-linear-to-b from-blue-50/40 to-white"
                stepNumber={stepNumber}
                stats={stats}
                onSettingsClick={data.onSettingsClick as (() => void) | undefined}
                nodeId={id}
                onAddStep={onAddStep}
                onCopy={onCopy}
                onDelete={onDelete}
                statOrder={['active', 'completed']}
                density={density}
            >
                <div className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">Flow trigger</div>
                <div className="mt-2 leading-relaxed text-slate-700">Starts when <span className="font-semibold text-slate-900">{triggerLabel}</span> happens.</div>
            </NodeWrapper>
            <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white !shadow-md !shadow-blue-300/60" />
        </>
    );
});

/**
 * ActionNode - Performs an action in the flow (send email, SMS, etc).
 */
export const ActionNode = memo(({ data, id }: NodeProps) => {
    const nodeData = data as unknown as FlowNodeData;
    const config = nodeData.config;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;
    const onAddStep = data.onAddStep as OnAddStepCallback | undefined;
    const onCopy = data.onCopy as OnCopyNodeCallback | undefined;
    const onDelete = data.onDelete as OnDeleteNodeCallback | undefined;
    const density = nodeData.density ?? 'comfortable';
    const isExitNode = config?.actionType === 'EXIT';
    const actionLabel = getActionLabel(config);

    return (
        <>
            <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white" />
            <NodeWrapper
                title={actionLabel}
                subtitle={config?.actionType === 'SEND_EMAIL' ? 'Email' : undefined}
                icon={getActionIcon(config)}
                iconBgColor={getActionGradient(config)}
                borderColor="border-emerald-200"
                bgColor="bg-linear-to-b from-emerald-50/35 to-white"
                stepNumber={stepNumber}
                stats={stats}
                nodeId={id}
                onAddStep={onAddStep}
                showAddButton={!isExitNode}
                onCopy={onCopy}
                onDelete={onDelete}
                statOrder={['completed', 'skipped', 'failed', 'queued', 'active']}
                density={density}
            >
                <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{config?.actionType === 'SEND_EMAIL' ? 'Email step' : 'Action step'}</div>
                <div className="font-semibold text-slate-900 mt-2">{actionLabel}</div>
                {config?.subject
                    ? <div className="text-xs text-slate-600 truncate mt-1.5 max-w-[240px]">{config.subject}</div>
                    : <div className="text-xs text-slate-500 mt-1.5">Set up this step in the sidebar.</div>}
                {config?.actionType === 'SEND_EMAIL' && (
                    <button className="mt-2.5 inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors">
                        <Eye size={12} />View Analytics
                    </button>
                )}
            </NodeWrapper>
            {!isExitNode && <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-white !shadow-md !shadow-emerald-300/60" />}
        </>
    );
});

/**
 * DelayNode - Adds a time delay before the next step.
 */
export const DelayNode = memo(({ data, id }: NodeProps) => {
    const nodeData = data as unknown as FlowNodeData;
    const config = nodeData.config;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;
    const onAddStep = data.onAddStep as OnAddStepCallback | undefined;
    const onCopy = data.onCopy as OnCopyNodeCallback | undefined;
    const onDelete = data.onDelete as OnDeleteNodeCallback | undefined;
    const density = nodeData.density ?? 'comfortable';

    const duration = config?.duration || 1;
    const unit = config?.unit || 'hours';
    const delayDays = config?.delayUntilDays ?? [];
    let delayDescription = `Delay of ${duration} ${duration === 1 ? unit.slice(0, -1) : unit}.`;
    if (config?.delayUntilTime) delayDescription = `Wait until ${config.delayUntilTime}`;
    if (delayDays.length > 0) delayDescription += ` on ${delayDays.join(', ')}`;

    return (
        <>
            <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white" />
            <NodeWrapper
                title="Delay"
                subtitle="Delay for a specific period"
                icon={<Clock size={16} className="text-white" />}
                iconBgColor="bg-linear-to-br from-yellow-500 to-orange-500"
                borderColor="border-amber-200"
                bgColor="bg-linear-to-b from-amber-50/35 to-white"
                stepNumber={stepNumber}
                stats={stats}
                nodeId={id}
                onAddStep={onAddStep}
                onCopy={onCopy}
                onDelete={onDelete}
                statOrder={['queued', 'completed']}
                density={density}
            >
                <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Wait step</div>
                <div className="font-semibold text-slate-900 mt-2">{delayDescription}</div>
            </NodeWrapper>
            <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-amber-500 !border-2 !border-white !shadow-md !shadow-amber-300/60" />
        </>
    );
});

/**
 * ConditionNode - Splits the flow based on a condition.
 */
export const ConditionNode = memo(({ data, id }: NodeProps) => {
    const nodeData = data as unknown as FlowNodeData;
    const config = nodeData.config;
    const stats = data.stats as NodeStats | undefined;
    const stepNumber = data.stepNumber as number | undefined;
    const onAddStep = data.onAddStep as OnAddStepCallback | undefined;
    const onCopy = data.onCopy as OnCopyNodeCallback | undefined;
    const onDelete = data.onDelete as OnDeleteNodeCallback | undefined;
    const density = nodeData.density ?? 'comfortable';

    const conditionRules = Array.isArray(config?.conditions)
        ? config.conditions.filter((rule: { field?: string; operator?: string; value?: string }) => rule?.field && rule?.operator && String(rule?.value ?? '').trim() !== '')
        : [];
    const conditionPreview = conditionRules.length > 0
        ? `${conditionRules[0].field} ${conditionRules[0].operator} ${conditionRules[0].value}${conditionRules.length > 1 ? ` (+${conditionRules.length - 1})` : ''}`
        : (config?.field && config?.operator && String(config?.value ?? '').trim() !== ''
            ? `${config.field} ${config.operator} ${config.value}`
            : 'Configure condition...');

    return (
        <>
            <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white" />
            <NodeWrapper
                title="Condition"
                subtitle="Split based on rules"
                icon={<Split size={16} className="text-white" />}
                iconBgColor="bg-linear-to-br from-orange-500 to-red-500"
                borderColor="border-orange-200"
                bgColor="bg-linear-to-b from-orange-50/35 to-white"
                stepNumber={stepNumber}
                stats={stats}
                nodeId={id}
                onAddStep={onAddStep}
                showAddButton={false}
                onCopy={onCopy}
                onDelete={onDelete}
                density={density}
            >
                <div className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 mb-2">Branch logic</div>
                <div className="font-semibold text-slate-900 mb-1">{data.label as string}</div>
                <div className="text-xs text-slate-600 mb-3 truncate">{conditionPreview}</div>
                <div className="flex justify-between items-center text-xs font-semibold pt-2.5 border-t border-orange-200">
                    <div className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">YES</div>
                    <div className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">NO</div>
                </div>
            </NodeWrapper>
            <Handle type="source" position={Position.Bottom} id="true" className="!bg-emerald-500 !w-2.5 !h-2.5 !border-2 !border-white !shadow-md !shadow-emerald-300/60" style={{ left: '25%' }} />
            <Handle type="source" position={Position.Bottom} id="false" className="!bg-rose-500 !w-2.5 !h-2.5 !border-2 !border-white !shadow-md !shadow-rose-300/60" style={{ left: '75%' }} />
        </>
    );
});
