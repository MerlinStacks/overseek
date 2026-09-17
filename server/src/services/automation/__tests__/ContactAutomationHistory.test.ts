import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getContactAutomationHistory, hasContactAction } from '../ContactAutomationHistory';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../../utils/prisma', () => ({ prisma: { automationEnrollment: { findMany } } }));

const event = (nodeType: string, actionType: string, outcome = 'NEXT') => ({
    nodeId: 'node-1', outcome, metadata: { nodeType, actionType }
});
const enrollment = (runEvents: ReturnType<typeof event>[], id = 'enrollment-1', flowDefinition = {}) => ({
    id, automation: { name: 'Flow', flowDefinition }, runEvents
});

describe('contact automation history', () => {
    beforeEach(() => vi.resetAllMocks());

    it.each([
        ['no execution', []],
        ['trigger', [event('trigger', '')]],
        ['condition', [event('condition', '', 'false')]],
        ['delay', [event('delay', '')]],
        ['exit', [event('action', 'EXIT')]],
        ['uppercase exit', [event('ACTION', 'exit')]],
        ['skipped email', [event('action', 'SEND_EMAIL', 'EMAIL_SKIPPED')]],
        ['failed email', [event('action', 'SEND_EMAIL', 'EMAIL_FAILED')]],
        ['unconfigured email', [event('action', 'SEND_EMAIL', 'EMAIL_NOT_CONFIGURED')]],
        ['unknown outcome', [event('action', 'SEND_EMAIL', '')]]
    ])('hides %s enrollments', (_label, events) => {
        expect(hasContactAction(enrollment(events))).toBe(false);
    });

    it.each(['actionType', 'config'])('recognizes legacy exits using flow %s', field => {
        const data = field === 'config' ? { config: { actionType: 'EXIT' } } : { actionType: 'EXIT' };
        expect(hasContactAction(enrollment([event('action', '')], 'legacy', {
            nodes: [{ id: 'node-1', data }]
        }))).toBe(false);
    });

    it.each([
        event('action', 'SEND_EMAIL', 'EMAIL_SENT'),
        event('ACTION', 'ADD_TAG'),
        event('action', 'UNSUBSCRIBE', 'UNSUBSCRIBED')
    ])('keeps performed actions even alongside an exit: %j', action => {
        expect(hasContactAction(enrollment([action, event('action', 'EXIT')]))).toBe(true);
    });

    it('reads past routing-only pages and does not expose internal flow data', async () => {
        findMany.mockResolvedValueOnce(Array.from({ length: 20 }, (_, i) =>
            enrollment([event('action', 'EXIT')], `exit-${i}`)))
            .mockResolvedValueOnce([enrollment([event('action', 'SEND_EMAIL', 'EMAIL_SENT')])]);

        expect(await getContactAutomationHistory('account-1', ['contact@example.com'])).toEqual([
            { id: 'enrollment-1', automation: { name: 'Flow' } }
        ]);
        expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            cursor: { id: 'exit-19' }, skip: 1,
            where: expect.objectContaining({
                automation: { accountId: 'account-1' },
                email: { in: ['contact@example.com'], mode: 'insensitive' }
            })
        }));
    });
});
