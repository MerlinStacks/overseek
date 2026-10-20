import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError, ExternalAPIError, getFriendlyMessage, handleRouteError, OverseekError, toErrorResponse, ValidationError } from './errors';
afterEach(() => vi.unstubAllEnvs());
describe('error response contracts', () => {
    it('omits context and causes from production responses and serialization', () => {
        vi.stubEnv('NODE_ENV', 'production');
        const error = new ExternalAPIError('Provider', 'raw upstream failure', { context: { token: 'private' }, cause: new Error('private cause') });
        expect(toErrorResponse(error)).toEqual({ error: 'A connected service is temporarily unavailable.', code: 'EXTERNAL_API_ERROR', isRecoverable: true });
        expect(JSON.stringify(error)).not.toContain('private');
    });
    it('retains diagnostic context only outside production', () => {
        vi.stubEnv('NODE_ENV', 'development');
        expect(toErrorResponse(new ValidationError('Invalid value', { field: 'name' })).context).toEqual({ field: 'name' });
    });
    it('keeps unknown failures generic and classifies network errors', () => {
        expect(toErrorResponse(new Error('Database password private')).error).not.toContain('private');
        expect(getFriendlyMessage(new Error('Network failed'))).toContain('Network error');
        expect(getFriendlyMessage(new Error('timeout'))).toContain('too long');
    });
    it('preserves status and recoverability in route responses', () => {
        const send = vi.fn(); const reply = { code: vi.fn(() => ({ send })) };
        handleRouteError(new AuthenticationError(), reply); expect(reply.code).toHaveBeenCalledWith(401);
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTHENTICATION_ERROR', isRecoverable: true }));
        expect(new OverseekError('Failure').statusCode).toBe(500);
    });
});
