import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/prisma', () => ({
    prisma: {
        analyticsEvent: {
            findMany: vi.fn(),
        },
    },
}));

import { prisma } from '../../../utils/prisma';
import { getSessionHistory } from '../LiveAnalytics';

describe('getSessionHistory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.analyticsEvent.findMany).mockResolvedValue([] as any);
    });

    it('scopes event history by the session account', async () => {
        await getSessionHistory('acct-1', 'session-1');

        expect(prisma.analyticsEvent.findMany).toHaveBeenCalledWith({
            where: { sessionId: 'session-1', session: { accountId: 'acct-1' } },
            orderBy: { createdAt: 'desc' },
        });
    });
});
