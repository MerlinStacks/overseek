import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxAIService } from '../InboxAIService';

const mocks = vi.hoisted(() => ({
    account: vi.fn(),
    conversation: vi.fn(),
    accountPrompt: vi.fn(),
    globalPrompt: vi.fn(),
    policies: vi.fn(),
    orders: vi.fn(),
    fetch: vi.fn()
}));

vi.mock('../../utils/prisma', () => ({
    prisma: {
        account: { findUnique: mocks.account },
        conversation: { findUnique: mocks.conversation },
        accountAIPrompt: { findUnique: mocks.accountPrompt },
        aIPrompt: { findUnique: mocks.globalPrompt },
        policy: { findMany: mocks.policies },
        wooOrder: { findMany: mocks.orders }
    }
}));

vi.mock('../../utils/cache', () => ({
    cacheAside: (_key: string, loader: () => Promise<unknown>) => loader(),
    CacheTTL: { LONG: 3600 }
}));

vi.mock('../../utils/logger', () => ({
    Logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

describe('InboxAIService draft history', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubGlobal('fetch', mocks.fetch);
        mocks.account.mockResolvedValue({ openRouterApiKey: 'test-key', aiModel: 'test-model' });
        mocks.accountPrompt.mockResolvedValue(null);
        mocks.globalPrompt.mockResolvedValue({ content: '{{conversation_history}}' });
        mocks.policies.mockResolvedValue([]);
        mocks.fetch.mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ choices: [{ message: { content: '<p>Draft reply</p>' } }] })
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([25, 3, 0])('includes only the latest 20 of %i messages in chronological order', async (count) => {
        const history = Array.from({ length: count }, (_, index) => ({
            id: `message-${String(index).padStart(2, '0')}`,
            content: `<p>History entry ${String(index).padStart(2, '0')}</p>`,
            senderType: index % 2 === 0 ? 'CUSTOMER' : 'AGENT',
            // Shared timestamps exercise the deterministic ID tie-breaker, including at the cutoff.
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, Math.floor(index / 2)))
        }));
        mocks.conversation.mockImplementation(async ({ include }) => ({
            wooCustomer: null,
            messages: [...history].sort((a, b) =>
                b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)
            ).slice(0, include.messages.take)
        }));

        const result = await InboxAIService.generateDraftReply('conversation-1', 'account-1');

        expect(mocks.conversation).toHaveBeenCalledExactlyOnceWith({
            where: { id: 'conversation-1', accountId: 'account-1' },
            include: {
                messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 },
                wooCustomer: true
            }
        });
        expect(result.draft).toBe('<p>Draft reply</p>');
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
        const request = JSON.parse(mocks.fetch.mock.calls[0][1].body);
        const expectedHistory = history.slice(-20).map((message) =>
            `[${message.createdAt.toLocaleString()}] ${message.senderType}: ${message.content.replace(/<\/?p>/g, '')}`
        ).join('\n');
        expect(request.messages[0].role).toBe('system');
        expect(request.messages[0].content.split('\n\nATTACHMENT HANDLING:')[0]).toBe(expectedHistory);
        for (const message of history.slice(0, Math.max(0, count - 20))) {
            expect(request.messages[0].content).not.toContain(message.content.replace(/<\/?p>/g, ''));
        }
    });

    it.each([
        {
            content: '<p>Here is the damage</p><img src="/uploads/attachments/photo.jpg" alt="Broken handle">',
            contentType: 'TEXT',
            expected: ['Here is the damage', '[Inline image/photo; sender-provided description: Broken handle; contents not inspected]']
        },
        {
            content: '<p>Photo attached</p><IMG SRC="cid:photo@example.com">',
            contentType: 'TEXT',
            expected: ['Photo attached', '[Inline image/photo; contents not inspected]']
        },
        {
            content: '[Attachment: receipt.pdf](/uploads/attachments/receipt.pdf)',
            contentType: 'TEXT',
            expected: ['[Attachment: receipt.pdf](/uploads/attachments/receipt.pdf)']
        },
        {
            content: '/uploads/photo.jpg',
            contentType: 'IMAGE',
            expected: ['[Image/photo message; contents not inspected]', '/uploads/photo.jpg']
        },
        {
            content: 'Attachment (image): https://example.com/photo.jpg',
            contentType: 'FILE',
            expected: ['[File/attachment message; contents not inspected]', 'Attachment (image): https://example.com/photo.jpg']
        }
    ])('preserves attachment evidence for $contentType messages: $content', async ({ content, contentType, expected }) => {
        mocks.conversation.mockResolvedValue({
            wooCustomer: null,
            messages: [{ content, contentType, senderType: 'CUSTOMER', createdAt: new Date() }]
        });

        const result = await InboxAIService.generateDraftReply('conversation-1', 'account-1');

        expect(result.error).toBeUndefined();
        expect(mocks.fetch).toHaveBeenCalledTimes(1); // No attachment URL requests.
        const prompt = JSON.parse(mocks.fetch.mock.calls[0][1].body).messages[0].content;
        expect(prompt).toContain('CUSTOMER:');
        for (const text of expected) expect(prompt).toContain(text);
        expect(prompt).not.toMatch(/<img\b/i);
        expect(prompt).toContain('Do not ask the customer to send the same evidence again');
        expect(prompt).toContain('not image pixels or document contents');
    });

    it('keeps agent attachments attributed to the agent and applies guidance to custom prompts', async () => {
        mocks.accountPrompt.mockResolvedValue({ content: 'Custom reply prompt\n{{conversation_history}}' });
        mocks.conversation.mockResolvedValue({
            wooCustomer: null,
            messages: [{ content: '<img src="/uploads/example.png" alt=Example>', senderType: 'AGENT', createdAt: new Date() }]
        });

        await InboxAIService.generateDraftReply('conversation-1', 'account-1');

        const prompt = JSON.parse(mocks.fetch.mock.calls[0][1].body).messages[0].content;
        expect(prompt).toContain('Custom reply prompt');
        expect(prompt).toContain('AGENT: [Inline image/photo; sender-provided description: Example; contents not inspected]');
        expect(prompt).toContain('distinguish CUSTOMER uploads from AGENT uploads');
    });

    it('does not generate a draft for a conversation belonging to another account', async () => {
        mocks.conversation.mockImplementation(async ({ where }) =>
            where.id === 'conversation-1' && where.accountId === 'other-account'
                ? { messages: [], wooCustomer: null }
                : null
        );

        const result = await InboxAIService.generateDraftReply('conversation-1', 'account-1');

        expect(mocks.conversation).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'conversation-1', accountId: 'account-1' }
        }));
        expect(result).toEqual({ draft: '', error: 'Conversation not found' });
        expect(mocks.orders).not.toHaveBeenCalled();
        expect(mocks.policies).not.toHaveBeenCalled();
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
});
