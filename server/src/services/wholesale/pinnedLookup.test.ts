import { describe, expect, it, vi } from 'vitest';
import { createPinnedLookup } from './pinnedLookup';

describe('createPinnedLookup', () => {
    it('returns the legacy address and family callback shape', () => {
        const callback = vi.fn();
        createPinnedLookup('203.0.113.10', 4)('store.example', {}, callback);
        expect(callback).toHaveBeenCalledWith(null, '203.0.113.10', 4);
    });

    it('returns an address array when Node requests all lookup results', () => {
        const callback = vi.fn();
        createPinnedLookup('2001:db8::10', 6)('store.example', { all: true }, callback);
        expect(callback).toHaveBeenCalledWith(null, [{ address: '2001:db8::10', family: 6 }]);
    });
});
