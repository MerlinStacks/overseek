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
});
