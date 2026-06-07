import { describe, expect, it } from 'vitest';
import { findNextNodeId, renderTemplate } from '../FlowNavigator';

describe('renderTemplate', () => {
    it('preserves unresolved tags when requested', () => {
        const result = renderTemplate(
            'Hi {{customer.firstName}}, order {{order.number}} is ready',
            { order: { number: '1001' } },
            { preserveUnknown: true }
        );

        expect(result).toBe('Hi {{customer.firstName}}, order 1001 is ready');
    });

    it('keeps default behavior of clearing unresolved tags', () => {
        const result = renderTemplate('Hi {{customer.firstName}}', {});

        expect(result).toBe('Hi ');
    });

    it('uses fallback syntax when unresolved tags are not preserved', () => {
        const result = renderTemplate('Hi {{customer.firstName | fallback: "there"}}', {});

        expect(result).toBe('Hi there');
    });

    it('preserves unresolved fallback tags when requested for merge resolution', () => {
        const result = renderTemplate('Hi {{customer.firstName | fallback: "there"}}', {}, { preserveUnknown: true });

        expect(result).toBe('Hi {{customer.firstName | fallback: "there"}}');
    });
});

describe('findNextNodeId', () => {
    const flow = {
        nodes: [],
        edges: [
            { id: 'yes-edge', source: 'condition', target: 'yes-node', sourceHandle: 'true' },
            { id: 'no-edge', source: 'condition', target: 'no-node', sourceHandle: 'false' },
        ],
    };

    it('follows the matching condition branch', () => {
        expect(findNextNodeId(flow, 'condition', 'false')).toBe('no-node');
        expect(findNextNodeId(flow, 'condition', 'true')).toBe('yes-node');
    });

    it('does not fall back to the first edge for missing condition branches', () => {
        const missingNoBranch = {
            nodes: [],
            edges: [
                { id: 'yes-edge', source: 'condition', target: 'yes-node', sourceHandle: 'true' },
            ],
        };

        expect(findNextNodeId(missingNoBranch, 'condition', 'false')).toBeNull();
    });
});
