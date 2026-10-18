import { describe, expect, it } from 'vitest';
import { describeAudienceRejection, sanitizeAudienceErrorText } from './nativeAudienceDiagnostics';

describe('Native audience rejection diagnostics', () => {
    it('keeps Meta error codes, user guidance and support reference', () => {
        const detail = describeAudienceRejection('META', 400, { error: {
            code: 100, error_subcode: 1713231, error_user_title: 'Update Restricted Fields and Rule',
            error_user_msg: 'Update the restricted fields and the rule.', fbtrace_id: 'Ref_ABC123'
        } });
        expect(detail).toContain('code 100; subcode 1713231');
        expect(detail).toContain('Update the restricted fields and the rule.');
        expect(detail).toContain('Reference: Ref_ABC123');
    });
    it('shows useful generic provider messages when no user-facing error is present', () => {
        expect(describeAudienceRejection('META', 400, { error: { code: 100, message: 'Param rule must be a JSON-encoded string.' } })).toContain('Param rule must be a JSON-encoded string.');
    });
    it('keeps relevant Google field errors too', () => {
        expect(describeAudienceRejection('GOOGLE', 400, { error: {
            code: 400, message: 'Invalid argument', details: [{ errors: [{ message: 'Membership lifespan exceeds the maximum' }] }]
        } })).toContain('Membership lifespan exceeds the maximum');
    });
    it('redacts exact configured credentials, bearer tokens, token parameters, emails and email hashes', () => {
        const text = sanitizeAudienceErrorText(`Invalid rule: configured-value Bearer opaque-token access_token=other-token client_secret="some-secret" user@example.com ${'a'.repeat(64)}`, ['configured-value']);
        for (const secret of ['configured-value', 'opaque-token', 'other-token', 'some-secret', 'user@example.com', 'a'.repeat(64)]) expect(text).not.toContain(secret);
        expect(text).toContain('Invalid rule');
    });
    it('does not retain nested provider request/response data', () => {
        const text = describeAudienceRejection('META', 400, { error: { code: 100, message: 'Bad rule', request: { secret: 'private nested data' } } });
        expect(text).toContain('Bad rule');
        expect(text).not.toContain('private nested data');
    });
    it('bounds output and strips control characters and markup', () => {
        expect(sanitizeAudienceErrorText('<script>test</script>\nBad rule\u0000')).toBe('test Bad rule');
        expect(describeAudienceRejection('META', 400, { error: { message: 'x'.repeat(10000) } }).length).toBeLessThanOrEqual(2000);
    });
});
