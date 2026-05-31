import type { Edge, Node } from '@xyflow/react';

export type FlowIssueSeverity = 'warning' | 'blocking';

export interface FlowIssue {
    id: string;
    nodeId?: string;
    severity: FlowIssueSeverity;
    message: string;
}

const OPERATORS_WITHOUT_VALUE = new Set(['is_set', 'not_set']);
const SUPPORTED_ACTIONS = new Set([
    'SEND_EMAIL',
    'SEND_SMS',
    'ADD_TAG',
    'REMOVE_TAG',
    'WEBHOOK',
    'GENERATE_COUPON',
    'ADD_ORDER_NOTE',
    'UPDATE_ORDER_STATUS',
    'GOAL',
    'JUMP',
    'EXIT',
]);

function getNodeConfig(node: Node): Record<string, unknown> {
    const data = (node.data || {}) as Record<string, unknown>;
    return ((data.config || {}) as Record<string, unknown>) || {};
}

function hasText(value: unknown) {
    return String(value || '').trim().length > 0;
}

function isEmailLike(value: string) {
    return /^\S+@\S+\.\S+$/.test(value);
}

function isMergeTag(value: string) {
    return /\{\{[^}]+\}\}/.test(value);
}

function hasConditionValue(condition: Record<string, unknown>) {
    const operator = String(condition.operator || '');
    if (OPERATORS_WITHOUT_VALUE.has(operator)) return true;
    return hasText(condition.value);
}

export function getSupportedFlowActionIds() {
    return SUPPORTED_ACTIONS;
}

export function validateFlow(nodes: Node[], edges: Edge[]): FlowIssue[] {
    const issues: FlowIssue[] = [];
    const nodeIds = new Set(nodes.map((node) => node.id));
    const triggerNodes = nodes.filter((node) => node.type === 'trigger');

    if (nodes.length === 0) {
        issues.push({ id: 'flow-empty', severity: 'warning', message: 'Add a trigger to start this flow.' });
        return issues;
    }

    if (triggerNodes.length === 0) {
        issues.push({ id: 'missing-trigger', severity: 'blocking', message: 'Flow needs a trigger before it can run.' });
    }

    if (triggerNodes.length > 1) {
        issues.push({ id: 'multiple-triggers', severity: 'warning', message: 'Flow has more than one trigger. Keep one entry point for predictable runs.' });
    }

    edges.forEach((edge) => {
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
            issues.push({ id: `dangling-edge-${edge.id}`, severity: 'blocking', message: 'A connection points to a missing step.' });
        }
    });

    nodes.forEach((node) => {
        const config = getNodeConfig(node);
        const incoming = edges.filter((edge) => edge.target === node.id);
        const outgoing = edges.filter((edge) => edge.source === node.id);

        if (node.type !== 'trigger' && incoming.length === 0) {
            issues.push({ id: `disconnected-in-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'This step is not connected to the flow.' });
        }

        if (node.type === 'trigger' && outgoing.length === 0) {
            issues.push({ id: `trigger-no-next-${node.id}`, nodeId: node.id, severity: 'warning', message: 'Trigger has no next step.' });
        }

        if (node.type === 'action') {
            const actionType = String(config.actionType || 'SEND_EMAIL');
            if (!SUPPORTED_ACTIONS.has(actionType)) {
                issues.push({ id: `unsupported-action-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'This action is not implemented yet.' });
            }

            if (actionType === 'SEND_EMAIL') {
                const emailCategory = String(config.emailCategory || (config.isTransactional ? 'TRANSACTIONAL' : 'MARKETING'));
                const htmlContent = String(config.htmlContent || '');
                const subject = String(config.subject || '');
                const to = String(config.to || '{{customer.email}}');

                if (!hasText(to)) issues.push({ id: `email-to-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Email recipient is required.' });
                const invalidRecipients = to.split(',').map((entry) => entry.trim()).filter(Boolean).filter((recipient) => !isMergeTag(recipient) && !isEmailLike(recipient));
                if (invalidRecipients.length > 0) issues.push({ id: `email-to-invalid-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Email recipient must be an email address or merge tag.' });
                if (!hasText(subject)) issues.push({ id: `email-subject-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Email subject is required.' });
                if (!hasText(htmlContent)) issues.push({ id: `email-content-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Email content is empty.' });
                if (config.overrideFrom) {
                    const fromEmail = String(config.fromEmail || '').trim();
                    const replyToEmail = String(config.replyToEmail || '').trim();
                    if (fromEmail && !isEmailLike(fromEmail)) issues.push({ id: `email-from-invalid-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Override From Email is invalid.' });
                    if (replyToEmail && !isEmailLike(replyToEmail)) issues.push({ id: `email-reply-to-invalid-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Reply To Email is invalid.' });
                }
                if (subject.length > 80) issues.push({ id: `email-subject-long-${node.id}`, nodeId: node.id, severity: 'warning', message: 'Subject is long and may be truncated in inboxes.' });
                if (emailCategory === 'MARKETING' && !htmlContent.toLowerCase().includes('unsubscribe')) {
                    issues.push({ id: `email-unsubscribe-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Marketing email should include unsubscribe wording or link.' });
                }
                if (emailCategory === 'MARKETING' && !htmlContent.includes('{{unsubscribe_url}}')) {
                    issues.push({ id: `email-unsubscribe-url-${node.id}`, nodeId: node.id, severity: 'warning', message: 'Add {{unsubscribe_url}} so each recipient gets a working unsubscribe link.' });
                }
            }
        }

        if (node.type === 'delay') {
            const duration = Number(config.duration || 0);
            if (!Number.isFinite(duration) || duration <= 0) {
                issues.push({ id: `delay-duration-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Delay duration must be greater than zero.' });
            }
        }

        if (node.type === 'condition') {
            const conditions = Array.isArray(config.conditions) ? config.conditions as Record<string, unknown>[] : [];
            const hasAdvancedRule = conditions.some((condition) => hasText(condition.field) && hasText(condition.operator) && hasConditionValue(condition));
            const hasLegacyRule = hasText(config.field) && hasText(config.operator) && (OPERATORS_WITHOUT_VALUE.has(String(config.operator || '')) || hasText(config.value));

            if (!hasAdvancedRule && !hasLegacyRule) {
                issues.push({ id: `condition-rule-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Condition needs at least one complete rule.' });
            }

            const hasYes = outgoing.some((edge) => edge.sourceHandle === 'true');
            const hasNo = outgoing.some((edge) => edge.sourceHandle === 'false');
            if (!hasYes) issues.push({ id: `condition-yes-${node.id}`, nodeId: node.id, severity: 'warning', message: 'YES branch is empty.' });
            if (!hasNo) issues.push({ id: `condition-no-${node.id}`, nodeId: node.id, severity: 'warning', message: 'NO branch is empty.' });
        }
    });

    return issues;
}

export function groupFlowIssuesByNode(issues: FlowIssue[]) {
    return issues.reduce<Record<string, FlowIssue[]>>((acc, issue) => {
        if (!issue.nodeId) return acc;
        acc[issue.nodeId] = [...(acc[issue.nodeId] || []), issue];
        return acc;
    }, {});
}
