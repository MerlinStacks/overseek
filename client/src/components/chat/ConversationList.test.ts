import { describe, expect, it } from 'vitest';
import { normalizeSearchConversation } from './ConversationList';

describe('normalizeSearchConversation', () => {
    it('normalizes nested conversation label records', () => {
        const conversation = normalizeSearchConversation({
            id: 'conversation-1',
            messages: [],
            updatedAt: '2026-08-08T00:00:00Z',
            status: 'OPEN',
            labels: [{ label: { id: 'label-1', name: 'VIP', color: '#fff' } }],
        });

        expect(conversation.labels).toEqual([{ id: 'label-1', name: 'VIP', color: '#fff' }]);
    });
});
