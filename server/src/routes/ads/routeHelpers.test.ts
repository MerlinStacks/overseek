import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { getAdsAccountIdOrReply, parsePositiveInt } from './routeHelpers';
describe('strict bounded pagination', () => {
    it.each(['12junk', '1.5', '1e3', '-1', '0', '', '01', '9007199254740993', '10001', ['1']])('rejects %j', value => expect(() => parsePositiveInt(value, 1, 10000)).toThrow());
    it('uses defaults only for omitted values and bounds derived offsets', () => {
        expect(parsePositiveInt(undefined, 20, 100)).toBe(20); expect(parsePositiveInt('10000', 1, 10000) * parsePositiveInt('100', 20, 100)).toBe(1000000);
    });
    it('checks accountId shape without claiming membership enforcement', () => {
        const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
        expect(getAdsAccountIdOrReply({ accountId: 'a' }, reply as unknown as FastifyReply)).toBe('a');
        expect(getAdsAccountIdOrReply({ accountId: ' ' }, reply as unknown as FastifyReply)).toBeNull(); expect(reply.code).toHaveBeenCalledWith(400);
    });
});
