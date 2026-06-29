import { FlowDefinition, FlowNode } from './types';

export type AutomationFlowIssueSeverity = 'warning' | 'blocking';

export interface AutomationFlowIssue {
    id: string;
    nodeId?: string;
    severity: AutomationFlowIssueSeverity;
    message: string;
}

export class FlowValidationError extends Error {
    issues: AutomationFlowIssue[];

    constructor(issues: AutomationFlowIssue[]) {
        super(`Automation flow is invalid: ${issues.map((issue) => issue.message).join('; ')}`);
        this.name = 'FlowValidationError';
        this.issues = issues;
    }
}

const SUPPORTED_ACTIONS = new Set([
    'SEND_EMAIL',
    'SEND_SMS',
    'ADD_TAG',
    'GENERATE_COUPON',
    'ADD_ORDER_NOTE',
    'UPDATE_ORDER_STATUS',
    'UNSUBSCRIBE',
    'GENERATE_INVOICE',
    'ASSIGN_CONVERSATION',
    'CLOSE_CONVERSATION',
    'ADD_NOTE',
    'SEND_CANNED_RESPONSE',
]);

const ALLOWED_DELAY_UNITS = new Set(['minutes', 'hours', 'days', 'weeks', 'months']);
const OPERATORS_WITHOUT_VALUE = new Set(['is_set', 'not_set']);
const SUPPORTED_TRIGGERS = new Set([
    'ORDER_CREATED',
    'ORDER_PAID',
    'ORDER_COMPLETED',
    'ORDER_STATUS_CHANGED',
    'FIRST_ORDER',
    'ABANDONED_CART',
    'REVIEW_LEFT',
    'ARTWORK_UPLOADED',
    'ARTWORK_APPROVAL_REQUESTED',
    'ARTWORK_APPROVED',
    'ARTWORK_CHANGES_REQUESTED',
    'ARTWORK_OVERRIDE_USED',
    'SHIPMENT_RECEIVED_BY_CARRIER',
    'SHIPMENT_IN_TRANSIT',
    'SHIPMENT_OUT_FOR_DELIVERY',
    'SHIPMENT_DELIVERY_ATTEMPTED',
    'SHIPMENT_DELIVERED',
    'SHIPMENT_EXCEPTION',
    'CUSTOMER_CREATED',
    'NO_PURCHASE_IN_X_DAYS',
    'TAG_ADDED',
    'MESSAGE_RECEIVED',
    'CONVERSATION_ASSIGNED',
    'CONVERSATION_CLOSED',
]);

function getConfig(node: FlowNode): Record<string, unknown> {
    return ((node.data?.config || node.data || {}) as Record<string, unknown>) || {};
}

function hasText(value: unknown): boolean {
    return String(value || '').trim().length > 0;
}

function isEmailLike(value: string): boolean {
    return /^\S+@\S+\.\S+$/.test(value);
}

function isMergeTag(value: string): boolean {
    return /\{\{[^}]+\}\}/.test(value);
}

function hasConditionValue(condition: Record<string, unknown>): boolean {
    const operator = String(condition.operator || '');
    if (OPERATORS_WITHOUT_VALUE.has(operator)) return true;
    return hasText(condition.value);
}

export function validateAutomationFlow(flow: FlowDefinition | null | undefined): AutomationFlowIssue[] {
    const issues: AutomationFlowIssue[] = [];
    const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
    const edges = Array.isArray(flow?.edges) ? flow.edges : [];
    const nodeIds = new Set(nodes.map((node) => node.id));
    const triggerNodes = nodes.filter((node) => String(node.type).toLowerCase() === 'trigger');

    if (nodes.length === 0) {
        issues.push({ id: 'flow-empty', severity: 'blocking', message: 'Flow needs at least one trigger.' });
        return issues;
    }

    if (triggerNodes.length === 0) {
        issues.push({ id: 'missing-trigger', severity: 'blocking', message: 'Flow needs a trigger before it can run.' });
    }

    if (triggerNodes.length > 1) {
        issues.push({ id: 'multiple-triggers', severity: 'blocking', message: 'Flow must have one trigger.' });
    }

    for (const edge of edges) {
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
            issues.push({ id: `dangling-edge-${edge.id}`, severity: 'blocking', message: 'A connection points to a missing step.' });
        }
    }

    for (const node of nodes) {
        const config = getConfig(node);
        const nodeType = String(node.type).toLowerCase();
        const incoming = edges.filter((edge) => edge.target === node.id);
        const outgoing = edges.filter((edge) => edge.source === node.id);

        if (nodeType !== 'trigger' && incoming.length === 0) {
            issues.push({ id: `disconnected-in-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'This step is not connected to the flow.' });
        }

        if (nodeType !== 'condition' && outgoing.length > 1) {
            issues.push({ id: `duplicate-out-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'This step has more than one outgoing path.' });
        }

        if (nodeType === 'trigger') {
            const triggerType = String(config.triggerType || '').toUpperCase();
            if (!SUPPORTED_TRIGGERS.has(triggerType)) {
                issues.push({ id: `unsupported-trigger-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'This trigger is not implemented yet.' });
            }
        }

        if (nodeType === 'action') {
            const actionType = String(config.actionType || 'SEND_EMAIL').toUpperCase();
            if (!SUPPORTED_ACTIONS.has(actionType)) {
                issues.push({ id: `unsupported-action-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'This action is not implemented yet.' });
            }

            if (actionType === 'SEND_EMAIL') {
                const emailCategory = String(config.emailCategory || (config.isTransactional ? 'TRANSACTIONAL' : 'MARKETING')).toUpperCase();
                const htmlContent = String(config.htmlContent || config.body || config.html || '');
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
                if (emailCategory === 'MARKETING' && !htmlContent.toLowerCase().includes('unsubscribe')) {
                    issues.push({ id: `email-unsubscribe-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Marketing email should include unsubscribe wording or link.' });
                }
            }

            if (actionType === 'SEND_SMS' && !hasText(config.smsMessage) && !hasText(config.body) && !hasText(config.message)) {
                issues.push({ id: `sms-content-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'SMS content is required.' });
            }
        }

        if (nodeType === 'delay') {
            const delayMode = String(config.delayMode || 'SPECIFIC_PERIOD').toUpperCase();
            const duration = Number(config.duration || config.value || 0);
            const unit = String(config.unit || 'hours').toLowerCase();

            if (delayMode !== 'SPECIFIC_PERIOD') {
                issues.push({ id: `delay-mode-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'This delay mode is not supported yet.' });
            }
            if (!Number.isFinite(duration) || duration <= 0) {
                issues.push({ id: `delay-duration-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Delay duration must be greater than zero.' });
            }
            if (!ALLOWED_DELAY_UNITS.has(unit)) {
                issues.push({ id: `delay-unit-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Delay unit is invalid.' });
            }
            if (config.delayUntilTimeEnabled || config.delayUntilDaysEnabled || config.useContactTimezone || config.jumpIfPassed) {
                issues.push({ id: `delay-constraints-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Advanced delay constraints are not supported yet.' });
            }
        }

        if (nodeType === 'condition') {
            const conditions = Array.isArray(config.conditions) ? config.conditions as Record<string, unknown>[] : [];
            const hasAdvancedRule = conditions.some((condition) => hasText(condition.field) && hasText(condition.operator) && hasConditionValue(condition));
            const hasLegacyRule = hasText(config.field) && hasText(config.operator) && (OPERATORS_WITHOUT_VALUE.has(String(config.operator || '')) || hasText(config.value));

            if (!hasAdvancedRule && !hasLegacyRule) {
                issues.push({ id: `condition-rule-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Condition needs at least one complete rule.' });
            }

            const trueEdges = outgoing.filter((edge) => edge.sourceHandle === 'true');
            const falseEdges = outgoing.filter((edge) => edge.sourceHandle === 'false');
            if (trueEdges.length !== 1 || falseEdges.length !== 1 || outgoing.length > 2) {
                issues.push({ id: `condition-branches-${node.id}`, nodeId: node.id, severity: 'blocking', message: 'Condition needs exactly one YES and one NO branch.' });
            }
        }
    }

    return issues;
}

export function assertAutomationFlowCanRun(flow: FlowDefinition | null | undefined): void {
    const blockingIssues = validateAutomationFlow(flow).filter((issue) => issue.severity === 'blocking');
    if (blockingIssues.length > 0) {
        throw new FlowValidationError(blockingIssues);
    }
}
