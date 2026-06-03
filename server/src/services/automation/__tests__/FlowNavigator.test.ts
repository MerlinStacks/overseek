import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../FlowNavigator';

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
