import { automationConditionService } from '../AutomationConditionService';
import { resolveMergeTags } from '../MergeTagResolver';
import { calculateDelayDuration, findNextNodeId } from './FlowNavigator';
import type { FlowDefinition } from './types';

/** Deliberately does not import NodeExecutor, queues, email, SMS or coupon services. */
export function simulateFlow(flow: FlowDefinition, context: Record<string, any>) {
    const steps: Array<{ id: string; label: string; type: string; explanation: string; outcome?: string; to?: string; subject?: string }> = [];
    const seen = new Set<string>();
    let node = flow.nodes.find(node => node.type.toUpperCase() === 'TRIGGER');
    let stopped = 'End of path';
    while (node && steps.length < 500) {
        if (seen.has(node.id)) { stopped = 'Cycle detected; simulation stopped'; break; }
        seen.add(node.id);
        const type = node.type.toUpperCase();
        const config = node.data?.config || node.data || {};
        const step: typeof steps[number] = { id: node.id, label: String(node.data?.label || type), type, explanation: '' };
        if (type === 'CONDITION') {
            step.outcome = automationConditionService.evaluate(config, context) ? 'true' : 'false';
            step.explanation = `${step.outcome === 'true' ? 'YES' : 'NO'} branch: ${JSON.stringify(config.conditions || { field: config.field, operator: config.operator, value: config.value }).slice(0, 1000)}`;
        } else if (type === 'DELAY') {
            step.explanation = `Would wait ${calculateDelayDuration(config) / 60000} minutes. No waiting job created.`;
        } else if (type === 'TRIGGER') {
            step.explanation = 'Assumed entry point. Enrollment filters, re-entry limits and quiet hours are not simulated.';
        } else {
            const action = config.actionType || 'SEND_EMAIL';
            step.explanation = `Would execute ${action}. No action was performed.`;
            if (action === 'SEND_EMAIL') {
                step.to = resolveMergeTags(String(config.to || '{{customer.email}}'), context);
                step.subject = resolveMergeTags(String(config.subject || ''), context);
            }
            if (action === 'EXIT') { steps.push(step); stopped = 'Exit step'; break; }
        }
        steps.push(step);
        const next = findNextNodeId(flow, node.id, step.outcome);
        node = flow.nodes.find(candidate => candidate.id === next);
        if (!node && next) stopped = 'Next node is missing';
    }
    return { steps, stopped, note: 'Read-only simulation of current values. Future purchases, eligibility, delivery caps, quiet hours and side effects are not predicted.' };
}
