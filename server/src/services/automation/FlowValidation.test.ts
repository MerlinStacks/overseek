import { describe, expect, it } from 'vitest';
import { validateAutomationFlow } from './FlowValidation';

describe('validateAutomationFlow', () => {
    it('accepts legacy email body/html content fields used by the node executor', () => {
        const baseFlow = {
            nodes: [
                { id: 'trigger', type: 'trigger', data: { config: { triggerType: 'CUSTOMER_CREATED' } } },
                { id: 'email', type: 'action', data: { config: { actionType: 'SEND_EMAIL', subject: 'Welcome', emailCategory: 'TRANSACTIONAL' } } }
            ],
            edges: [{ id: 'edge-1', source: 'trigger', target: 'email' }]
        };

        expect(validateAutomationFlow({
            ...baseFlow,
            nodes: [
                baseFlow.nodes[0],
                { ...baseFlow.nodes[1], data: { config: { ...baseFlow.nodes[1].data.config, body: '<p>Hello</p>' } } }
            ]
        } as any).some((issue) => issue.id === 'email-content-email')).toBe(false);

        expect(validateAutomationFlow({
            ...baseFlow,
            nodes: [
                baseFlow.nodes[0],
                { ...baseFlow.nodes[1], data: { config: { ...baseFlow.nodes[1].data.config, html: '<p>Hello</p>' } } }
            ]
        } as any).some((issue) => issue.id === 'email-content-email')).toBe(false);
    });

    it('accepts exit action nodes as supported terminal steps', () => {
        const issues = validateAutomationFlow({
            nodes: [
                { id: 'trigger', type: 'trigger', data: { config: { triggerType: 'CUSTOMER_CREATED' } } },
                { id: 'exit', type: 'action', data: { config: { actionType: 'EXIT' } } },
            ],
            edges: [{ id: 'edge-1', source: 'trigger', target: 'exit' }],
        } as any);

        expect(issues.some((issue) => issue.id === 'unsupported-action-exit')).toBe(false);
    });

    it.each([
        ['ADD_TAG', {}, 'tag-name-action'],
        ['GENERATE_COUPON', { discountType: 'percent', amount: 0, expiryDays: 7 }, 'coupon-amount-action'],
        ['ADD_ORDER_NOTE', {}, 'order-note-action'],
        ['UPDATE_ORDER_STATUS', { orderStatus: 'not-a-status' }, 'order-status-action'],
    ])('rejects incomplete %s configuration', (actionType, config, expectedIssueId) => {
        const issues = validateAutomationFlow({
            nodes: [
                { id: 'trigger', type: 'trigger', data: { config: { triggerType: 'CUSTOMER_CREATED' } } },
                { id: 'action', type: 'action', data: { config: { actionType, ...config } } },
            ],
            edges: [{ id: 'edge-1', source: 'trigger', target: 'action' }],
        } as any);

        expect(issues.some((issue) => issue.id === expectedIssueId)).toBe(true);
    });
});
