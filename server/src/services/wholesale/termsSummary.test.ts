import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { account: { findUnique: mocks.findUnique } } }));

import { parseTermsSummaryResponse, WholesaleTermsSummaryService } from './termsSummary';

describe('wholesale AI terms suggestions', () => {
    beforeEach(() => vi.clearAllMocks());

    it('requires strict JSON and a suggestion meeting the requested reduction', () => {
        expect(parseTermsSummaryResponse('{"heading":"Payment","content":"Pay within 7 days."}', 40, 50)).toEqual({ heading: 'Payment', content: 'Pay within 7 days.' });
        expect(() => parseTermsSummaryResponse('```json\n{"heading":"Payment","content":"Short"}\n```', 100, 20)).toThrow(/invalid JSON/);
        expect(() => parseTermsSummaryResponse('{"heading":"Payment","content":"This output remains much too long for the requested target."}', 60, 50)).toThrow(/target reduction/);
        expect(() => parseTermsSummaryResponse('{"heading":"Payment","content":"Short","extra":true}', 100, 20)).toThrow(/invalid terms/);
    });

    it('returns manual guidance without calling OpenRouter when account configuration is incomplete', async () => {
        mocks.findUnique.mockResolvedValue({ openRouterApiKey: null, aiModel: 'model' });
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const result = await WholesaleTermsSummaryService.suggest('account-1', { heading: 'Payment', content: 'Payment must be received within seven calendar days.', targetReduction: 20 });
        expect(result).toHaveProperty('manualGuidance');
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});
