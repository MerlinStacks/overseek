import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma', () => ({ prisma: {} }));
vi.mock('../../utils/logger', () => ({
    Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('../SmsLogService', () => ({ recordSmsLog: vi.fn() }));

import { SmsService } from '../SmsService';

describe('SmsService', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('sends an Australian WooCommerce local number in E.164 format', async () => {
        const service = new SmsService();
        vi.spyOn(service as any, 'getCredentials').mockResolvedValue({
            accountSid: 'AC_test',
            authToken: 'token',
            fromNumber: '+61412345678'
        });
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            sid: 'SM_test',
            status: 'queued'
        }), {
            status: 201,
            headers: { 'content-type': 'application/json' }
        }));

        const result = await service.sendSms('0491764367', 'Test message', 'account-1');

        expect(result).toEqual({ success: true, messageId: 'SM_test' });
        const request = fetchMock.mock.calls[0][1];
        expect(request?.body).toBeInstanceOf(URLSearchParams);
        expect((request?.body as URLSearchParams).get('To')).toBe('+61491764367');
    });
});
