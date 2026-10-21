import { describe, expect, it } from 'vitest';
import { mapSyncError } from './syncErrors';
describe('structured sync error classification', () => {
    it.each([null, true, 401, { message: [] }, 'Order #401234 on dbshop failed'])('handles unknown input without substring misclassification %j', input => { expect(mapSyncError(input).code).toBe('UNKNOWN'); });
    it('prefers explicit statuses/codes and never promises a scheduled retry', () => {
        expect(mapSyncError({ response: { status: 401 } }).code).toBe('AUTH'); expect(mapSyncError({ code: 'P2034' }).code).toBe('DATABASE');
        const value = mapSyncError('HTTP 429: too many requests'); expect(value.code).toBe('RATE_LIMIT'); expect(value.friendlyMessage).not.toContain('automatically');
    });
});
