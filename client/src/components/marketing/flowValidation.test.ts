import type { Edge, Node } from '@xyflow/react';
import { validateFlow } from './flowValidation';

describe('validateFlow', () => {
    it('warns when a send email step is incomplete', () => {
        const nodes: Node[] = [
            { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { config: { triggerType: 'MANUAL' } } },
            { id: 'email', type: 'action', position: { x: 0, y: 100 }, data: { config: { actionType: 'SEND_EMAIL', subject: '' } } },
        ];
        const edges: Edge[] = [{ id: 'edge', source: 'trigger', target: 'email' }];

        const issues = validateFlow(nodes, edges);

        expect(issues.some((issue) => issue.id === 'email-subject-email')).toBe(true);
        expect(issues.some((issue) => issue.id === 'email-content-email')).toBe(true);
    });

    it('flags unsupported actions without blocking existing flow loading', () => {
        const nodes: Node[] = [
            { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { config: { triggerType: 'MANUAL' } } },
            { id: 'future', type: 'action', position: { x: 0, y: 100 }, data: { config: { actionType: 'HTTP_REQUEST' } } },
        ];
        const edges: Edge[] = [{ id: 'edge', source: 'trigger', target: 'future' }];

        const issues = validateFlow(nodes, edges);

        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'unsupported-action-future', nodeId: 'future', severity: 'blocking' }),
        ]));
    });

    it('allows unsubscribe action steps without extra config', () => {
        const nodes: Node[] = [
            { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { config: { triggerType: 'MANUAL' } } },
            { id: 'unsubscribe', type: 'action', position: { x: 0, y: 100 }, data: { config: { actionType: 'UNSUBSCRIBE' } } },
        ];
        const edges: Edge[] = [{ id: 'edge', source: 'trigger', target: 'unsubscribe' }];

        const issues = validateFlow(nodes, edges);

        expect(issues.some((issue) => issue.id === 'unsupported-action-unsubscribe')).toBe(false);
    });
});
