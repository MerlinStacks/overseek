import { describe, expect, it, vi } from 'vitest';
vi.mock('../MergeTagResolver', () => ({ resolveMergeTags: (value: string, context: any) => value.replace(/\{\{customer.email\}\}/g, context.customer?.email || '') }));
import { simulateFlow } from './FlowSimulation';

const flow = {
    nodes: [
        { id: 'start', type: 'trigger', data: {} },
        { id: 'check', type: 'condition', data: { config: { field: 'customer.totalSpent', operator: 'gte', value: '100' } } },
        { id: 'yes', type: 'action', data: { config: { actionType: 'SEND_EMAIL', to: '{{customer.email}}', subject: 'VIP' } } },
        { id: 'no', type: 'action', data: { config: { actionType: 'EXIT' } } },
    ],
    edges: [{ source: 'start', target: 'check' }, { source: 'check', target: 'yes', sourceHandle: 'true' }, { source: 'check', target: 'no', sourceHandle: 'false' }],
};
describe('read-only flow simulation', () => {
    it.each([[200, 'yes', 'true'], [20, 'no', 'false']])('uses actual conditions for spend %s', (spent, target, outcome) => {
        const result = simulateFlow(flow as any, { customer: { totalSpent: spent, email: 'alex@example.com' } });
        expect(result.steps.map(step => step.id)).toEqual(['start', 'check', target]);
        expect(result.steps[1].outcome).toBe(outcome);
        expect(result.note).toContain('side effects are not predicted');
    });
    it('shows a resolved recipient without executing an email action', () => {
        const result = simulateFlow(flow as any, { customer: { totalSpent: 200, email: 'alex@example.com' } });
        expect(result.steps[2]).toMatchObject({ to: 'alex@example.com', subject: 'VIP', explanation: 'Would execute SEND_EMAIL. No action was performed.' });
    });
    it('stops cyclic graphs', () => {
        const cyclic = { nodes: [flow.nodes[0]], edges: [{ source: 'start', target: 'start' }] };
        expect(simulateFlow(cyclic as any, {}).stopped).toContain('Cycle');
    });
    it('does not default a missing false branch to the yes action', () => {
        expect(simulateFlow({ ...flow, edges: flow.edges.slice(0, 2) } as any, { customer: { totalSpent: 1 } }).steps.map(step => step.id)).toEqual(['start', 'check']);
    });
});
