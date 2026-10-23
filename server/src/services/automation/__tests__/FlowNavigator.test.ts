import { describe, expect, it } from 'vitest';
import { calculateDelayDuration, findNextNodeId, renderTemplate } from '../FlowNavigator';
import { validateAutomationFlow } from '../FlowValidation';

describe('calculateDelayDuration', () => {
    it.each([
        [{ duration: 0.5, unit: 'hours' }, 1800000],
        [{ duration: '1.5', unit: 'days' }, 129600000],
        [{ value: '0.25', unit: 'minutes' }, 15000],
        [{ duration: '1e2', unit: 'minutes' }, 6000000],
        [{ duration: 2, value: 10, unit: 'hours' }, 7200000],
        [{ duration: 2 }, 7200000],
        [{ duration: 2, unit: 'HOURS' }, 7200000],
    ])('executes the duration accepted by validation (%j)', (config, expected) => {
        const issues = validateAutomationFlow({
            nodes: [
                { id: 'trigger', type: 'trigger', data: { config: { triggerType: 'CUSTOMER_CREATED' } } },
                { id: 'delay', type: 'delay', data: { config } },
            ],
            edges: [{ id: 'edge', source: 'trigger', target: 'delay' }],
        });
        expect(issues.filter(issue => issue.severity === 'blocking')).toEqual([]);
        expect(calculateDelayDuration(config)).toBe(expected);
    });

    it.each(['minutes', 'hours', 'days', 'weeks', 'months'])('continues supporting whole %s', unit => {
        const multipliers: Record<string, number> = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000, months: 2592000000 };
        expect(calculateDelayDuration({ value: '2', unit })).toBe(2 * multipliers[unit]);
    });
});

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
