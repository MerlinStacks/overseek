import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    account: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    findFirst: vi.fn(), findUnique: vi.fn(), reserve: vi.fn(),
    rows: new Map<string, any>()
}));
vi.mock('../utils/prisma', () => ({ prisma: {
    emailAccount: { findFirst: mocks.account },
    emailUnsubscribe: { findFirst: vi.fn().mockResolvedValue(null) },
    emailLog: {
        create: mocks.create, update: mocks.update, updateMany: mocks.updateMany,
        findFirst: mocks.findFirst, findFirstOrThrow: mocks.findFirst,
        findUnique: mocks.findUnique, count: vi.fn().mockResolvedValue(0)
    }
} }));
vi.mock('../utils/encryption', () => ({ decrypt: (value: string) => value }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./emailSendLifecycle', async (original) => ({
    ...await original<typeof import('./emailSendLifecycle')>(), reserveEmailSend: mocks.reserve
}));

import { EmailService } from './EmailService';
import { EmailDeferredError } from './emailSendLifecycle';

describe('durable email delivery', () => {
    let service: EmailService;
    let sendMail: ReturnType<typeof vi.fn>;
    let close: ReturnType<typeof vi.fn>;
    const send = (options: any = {}, attachments?: any[]) => service.sendEmail(
        'account', 'sender', 'customer@example.com', 'Hello',
        '<a href="https://shop.test">Shop</a><a href="{{unsubscribe_url}}">Unsubscribe</a>',
        attachments, { category: 'TRANSACTIONAL', ...options }
    );

    beforeEach(() => {
        vi.resetAllMocks();
        mocks.rows.clear();
        mocks.account.mockResolvedValue({ id: 'sender', email: 'support@example.com', name: 'Support', smtpEnabled: true });
        mocks.create.mockImplementation(async ({ data }) => {
            const row = { id: `log-${mocks.rows.size}`, retryCount: 0, maxRetries: 3, ...data };
            mocks.rows.set(row.id, row);
            return { ...row };
        });
        mocks.update.mockImplementation(async ({ where, data }) => {
            const row = mocks.rows.get(where.id);
            Object.assign(row, data);
            return { ...row };
        });
        mocks.updateMany.mockImplementation(async ({ where, data }) => {
            const row = mocks.rows.get(where.id);
            if (!row || (typeof where.status === 'string' && row.status !== where.status) ||
                (where.retryCount !== undefined && row.retryCount !== where.retryCount)) return { count: 0 };
            const retryCount = row.retryCount;
            Object.assign(row, data);
            if (data.retryCount?.increment) row.retryCount = retryCount + data.retryCount.increment;
            if (data.retryCount?.decrement) row.retryCount = retryCount - data.retryCount.decrement;
            return { count: 1 };
        });
        mocks.findFirst.mockImplementation(async ({ where }) => {
            const row = mocks.rows.get(where.id);
            return row && (!where.status || row.status === where.status) &&
                (where.canRetry === undefined || row.canRetry === where.canRetry) ? { ...row } : null;
        });
        mocks.findUnique.mockImplementation(async ({ where }) => {
            const row = [...mocks.rows.values()].find(row => row.idempotencyKey === where.accountId_idempotencyKey.idempotencyKey);
            return row ? { ...row } : null;
        });
        mocks.reserve.mockImplementation(async (_accountId, id) => {
            const row = mocks.rows.get(id);
            if (!['QUEUED', 'PENDING_RETRY'].includes(row.status)) throw new Error('Already claimed');
            row.status = 'SENDING';
            row.canRetry = false;
            return null;
        });
        service = new EmailService();
        sendMail = vi.fn().mockResolvedValue({ messageId: 'message' });
        close = vi.fn();
        vi.spyOn(service, 'createTransporter').mockResolvedValue({ sendMail, close } as any);
    });
    afterEach(() => vi.unstubAllGlobals());

    it.each(['smtp', 'relay'])('does not redeliver after %s accepts but success logging fails', async transport => {
        if (transport === 'relay') {
            mocks.account.mockResolvedValue({ smtpEnabled: true, relayEndpoint: 'https://relay.test', relayApiKey: 'secret' });
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, message_id: 'relay-message' }), {
                headers: { 'content-type': 'application/json' }
            })));
        }
        mocks.update.mockImplementation(async ({ where, data }) => {
            if (data.status === 'SUCCESS') throw new Error('Database unavailable');
            return Object.assign(mocks.rows.get(where.id), data);
        });
        await expect(send()).resolves.toHaveProperty('messageId');
        expect(mocks.rows.get('log-0')).toMatchObject({ status: 'SENDING', canRetry: false });
        expect(mocks.create).toHaveBeenCalledTimes(1);
        expect(sendMail).toHaveBeenCalledTimes(transport === 'smtp' ? 1 : 0);
    });

    it.each(['smtp', 'relay'])('sends complete HTML, readable text and direct unsubscribe links via %s', async transport => {
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, message_id: 'relay-message' }), {
            headers: { 'content-type': 'application/json' }
        }));
        if (transport === 'relay') {
            mocks.account.mockResolvedValue({ relayEndpoint: 'https://relay.test', relayApiKey: 'secret' });
            vi.stubGlobal('fetch', fetch);
        }
        await service.sendEmail('account', 'sender', 'customer@example.com', 'Hello',
            '<p>Hello &amp; welcome</p><a href="https://{{unsubscribe_url}}">Unsubscribe</a><a href="https://%7B%7Bpreferences_url%7D%7D">Preferences</a>',
            undefined, { source: 'TEST', category: 'MARKETING' });
        const message = transport === 'smtp' ? sendMail.mock.calls[0][0] : JSON.parse(fetch.mock.calls[0][1].body);
        expect(message.html).toContain('<html>');
        expect(message.html).toContain('</body></html>');
        expect(message.html).not.toMatch(/\{\{|https:\/\/https:|\/api\/email\/click\//);
        expect(message.text).toContain('Hello & welcome');
        expect(message.text).toContain('/api/email/unsubscribe/');
        expect(message.text).not.toContain('/api/email/track/');
        if (transport === 'smtp') {
            expect(message.headers['List-Unsubscribe']).toContain('/api/email/unsubscribe/');
            expect(message.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
        } else {
            expect(message.list_unsubscribe).toContain('/api/email/unsubscribe/');
            expect(message.list_unsubscribe_post).toBe('List-Unsubscribe=One-Click');
        }
    });

    it('does not contact a transport if the durable record cannot be created', async () => {
        mocks.create.mockRejectedValue(new Error('Database unavailable'));
        await expect(send()).rejects.toThrow('Database unavailable');
        expect(sendMail).not.toHaveBeenCalled();
    });

    it('bounds relay requests and treats lost responses as unknown without SMTP fallback', async () => {
        mocks.account.mockResolvedValue({ smtpEnabled: true, relayEndpoint: 'https://relay.test', relayApiKey: 'secret' });
        const fetch = vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError'));
        vi.stubGlobal('fetch', fetch);
        await expect(send()).rejects.toThrow('Timed out');
        expect(fetch.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal), headers: { 'Idempotency-Key': 'log-0' } });
        expect(sendMail).not.toHaveBeenCalled();
        expect(mocks.rows.get('log-0')).toMatchObject({ status: 'UNKNOWN', canRetry: false });
    });

    it('only one concurrent retry sends, and it updates the original row', async () => {
        sendMail.mockRejectedValueOnce(Object.assign(new Error('Try later'), { responseCode: 451 }));
        await expect(send()).rejects.toThrow();
        const results = await Promise.all([service.retryFailedEmail('log-0', 'account'), service.retryFailedEmail('log-0', 'account')]);
        expect(results.filter(result => result.success)).toHaveLength(1);
        expect(sendMail).toHaveBeenCalledTimes(2);
        expect(mocks.rows.size).toBe(1);
        expect(mocks.rows.get('log-0')).toMatchObject({ status: 'SUCCESS', retryCount: 1, canRetry: false });
    });

    it('caps repeated transient failures without creating fresh retryable logs', async () => {
        sendMail.mockRejectedValue(Object.assign(new Error('Try later'), { responseCode: 451 }));
        await expect(send()).rejects.toThrow();
        for (let i = 0; i < 5; i++) await service.retryFailedEmail('log-0', 'account');
        expect(sendMail).toHaveBeenCalledTimes(4);
        expect(mocks.rows.size).toBe(1);
        expect(mocks.rows.get('log-0')).toMatchObject({ retryCount: 3, canRetry: false });
    });

    it('does not retry permanent SMTP rejections', async () => {
        sendMail.mockRejectedValue(Object.assign(new Error('No such mailbox'), { responseCode: 550 }));
        await expect(send()).rejects.toThrow();
        expect(await service.retryFailedEmail('log-0', 'account')).toMatchObject({ success: false });
        expect(sendMail).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalled();
    });

    it('deduplicates completed recipients before quota checks', async () => {
        await send({ idempotencyKey: 'campaign:one:customer' });
        expect(await send({ idempotencyKey: 'campaign:one:customer' })).toMatchObject({ deduplicated: true });
        expect(sendMail).toHaveBeenCalledTimes(1);
        expect(mocks.reserve).toHaveBeenCalledTimes(1);
    });

    it('keeps quota-limited recipients queued and resumes the same payload', async () => {
        mocks.reserve.mockResolvedValueOnce(new Date(Date.now() + 86_400_000));
        await expect(send({ idempotencyKey: 'campaign:one:customer' })).rejects.toBeInstanceOf(EmailDeferredError);
        expect(mocks.rows.get('log-0').status).toBe('QUEUED');
        expect(sendMail).not.toHaveBeenCalled();
        await send({ idempotencyKey: 'campaign:one:customer' });
        expect(mocks.rows.size).toBe(1);
        expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('resends canonical content, attachments and headers with fresh tracking', async () => {
        const attachments = [{ filename: 'invoice.txt', content: Buffer.from('invoice') }];
        await send({ fromName: 'Sales', fromEmail: 'sales@example.com', replyToEmail: 'reply@example.com',
            inReplyTo: '<thread>', references: '<root>', idempotencyKey: 'original' }, attachments);
        await expect(service.resendEmail('log-0', 'account')).resolves.toMatchObject({ success: true });
        const first = sendMail.mock.calls[0][0];
        const second = sendMail.mock.calls[1][0];
        expect(second).toMatchObject({ from: first.from, replyTo: first.replyTo, inReplyTo: '<thread>', references: '<root>' });
        expect(second.attachments[0].content.equals(Buffer.from('invoice'))).toBe(true);
        expect(second.html.match(/\/api\/email\/track\//g)).toHaveLength(1);
        expect(second.html.match(/\/api\/email\/click\//g)).toHaveLength(1);
        expect(second.html).not.toContain(mocks.rows.get('log-0').trackingId);
        expect(mocks.rows.get('log-1').idempotencyKey).toBeUndefined();
    });

    it('keeps unqueued sends retryable and does not consume retries on quota deferral', async () => {
        mocks.reserve.mockResolvedValue(new Date(Date.now() + 86_400_000));
        await expect(send()).rejects.toBeInstanceOf(EmailDeferredError);
        expect(mocks.rows.get('log-0')).toMatchObject({ status: 'FAILED', canRetry: true });
        for (let i = 0; i < 5; i++) await service.retryFailedEmail('log-0', 'account');
        expect(mocks.rows.get('log-0')).toMatchObject({ status: 'FAILED', canRetry: true, retryCount: 0 });
        expect(sendMail).not.toHaveBeenCalled();
    });
});
