import { describe, expect, it } from 'vitest';
import { normalizeContactStatus, resolveContactStatus, strongestContactSuppression } from '../contactStatus';

describe('contact status classification', () => {
    it.each(['UNVERIFIED', 'SUBSCRIBED', 'BOUNCED', 'UNSUBSCRIBED', 'SOFT_BOUNCED', 'COMPLAINT'] as const)(
        'normalizes %s', status => {
            expect(normalizeContactStatus(` ${status.toLowerCase()} `)).toBe(status);
        }
    );

    it.each([undefined, null, '', 'invalid', 42, {}])('uses the requested fallback for %j', raw => {
        expect(normalizeContactStatus(raw)).toBe('UNVERIFIED');
        expect(normalizeContactStatus(raw, 'SUBSCRIBED')).toBe('SUBSCRIBED');
    });

    describe.each(['ALL', 'MARKETING'])('%s suppression', scope => {
        it.each(['UNVERIFIED', 'UNSUBSCRIBED', 'BOUNCED', 'SOFT_BOUNCED', 'COMPLAINT'])(
            'uses explicit %s rather than scope or raw complaint', contactStatus => {
                expect(resolveContactStatus('COMPLAINT', { scope, contactStatus: ` ${contactStatus.toLowerCase()} ` }))
                    .toBe(contactStatus);
            }
        );

        it.each([
            ['COMPLAINT', 'COMPLAINT'], ['BOUNCED', 'BOUNCED'], ['SOFT_BOUNCED', 'SOFT_BOUNCED'],
            ['SUBSCRIBED', 'UNSUBSCRIBED'], ['UNVERIFIED', 'UNSUBSCRIBED'],
            [undefined, 'UNSUBSCRIBED'], ['invalid', 'UNSUBSCRIBED']
        ])('resolves legacy null classification with raw %s as %s', (raw, expected) => {
            expect(resolveContactStatus(raw, { scope, contactStatus: null })).toBe(expected);
        });
    });

    it('ignores unsupported scopes and preserves the unsuppressed fallback', () => {
        expect(resolveContactStatus('SUBSCRIBED', { scope: 'TRANSACTIONAL', contactStatus: 'COMPLAINT' })).toBe('SUBSCRIBED');
        expect(resolveContactStatus(undefined, null)).toBe('UNVERIFIED');
        expect(resolveContactStatus(undefined, undefined, 'SUBSCRIBED')).toBe('SUBSCRIBED');
    });

    it('selects ALL before MARKETING, then delivery severity within a scope, without mutating rows', () => {
        const all = { scope: 'ALL', contactStatus: 'UNSUBSCRIBED', reason: 'Opt-out' };
        const marketing = { scope: 'MARKETING', contactStatus: 'COMPLAINT' };
        const rows = [marketing, all];
        expect(strongestContactSuppression(rows)).toBe(all);
        expect(rows).toEqual([marketing, all]);
        for (const scope of ['ALL', 'MARKETING']) {
            const complaint = { scope, contactStatus: 'COMPLAINT' };
            const bounce = { scope, contactStatus: 'BOUNCED' };
            const soft = { scope, contactStatus: 'SOFT_BOUNCED' };
            expect(strongestContactSuppression([soft, complaint, bounce])).toBe(complaint);
            expect(strongestContactSuppression([soft, bounce])).toBe(bounce);
        }
        expect(strongestContactSuppression([{ scope: 'TRANSACTIONAL', contactStatus: 'COMPLAINT' }])).toBeUndefined();
        expect(strongestContactSuppression([])).toBeUndefined();
    });
});
