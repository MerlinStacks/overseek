import { prisma } from '../../utils/prisma';
import { EventBus, EVENTS } from '../events';
import { PermissionService } from '../PermissionService';
import { providerJson, scopeId } from '../BoundedProviderWork';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
const BASE = 'https://graph.facebook.com/v24.0';
const externalId = z.string().regex(/^\d{1,100}$/);
const httpsUrl = z.string().max(2048).url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !/[\s()<>]/.test(value); });
const eventSchema = z.object({ sender: z.object({ id: externalId }), recipient: z.object({ id: externalId }), timestamp: z.number().int().nonnegative().max(8640000000000000), message: z.object({ mid: z.string().min(1).max(300), text: z.string().max(20000).optional(), is_echo: z.boolean().optional(), attachments: z.array(z.object({ type: z.string().max(50), payload: z.object({ url: httpsUrl.optional() }) })).max(10).optional() }).optional() });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class MetaMessagingService {
    static async sendMessage(socialAccountId: string, payload: { recipientId: string; message: string; messageType?: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG' }, authority?: { accountId: string; actorId: string; conversationId: string; operationId: string }): Promise<{ messageId: string }> {
        const auth = z.object({ accountId: scopeId, actorId: scopeId, conversationId: scopeId, operationId: scopeId }).parse(authority);
        const body = z.object({ recipientId: externalId, message: z.string().trim().min(1).max(20000), messageType: z.literal('RESPONSE').optional() }).strict().parse(payload);
        if (!await PermissionService.hasPermission(auth.actorId, auth.accountId, 'view_inbox')) throw new Error('Inbox permission required');
        const social = await prisma.socialAccount.findFirst({ where: { id: socialAccountId, accountId: auth.accountId, platform: { in: ['FACEBOOK', 'INSTAGRAM'] }, isActive: true } });
        if (!social) throw new Error('Scoped Meta channel unavailable'); externalId.parse(social.externalId);
        const conversation = await prisma.conversation.findFirst({ where: { id: auth.conversationId, accountId: auth.accountId, socialAccountId: social.id, externalConversationId: `${social.platform}:${social.externalId}:${body.recipientId}` } });
        if (!conversation) throw new Error('Scoped recipient unavailable');
        const id = `meta-send:${auth.accountId}:${hash([auth.conversationId, auth.operationId])}`, digest = hash([auth, socialAccountId, body]);
        const replay = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
            const previous = await tx.scopedOperation.findUnique({ where: { id } });
            if (previous) { const result = previous.result as any; if (result.digest !== digest || result.state !== 'complete') throw new Error('Meta delivery requires reconciliation; do not retry'); return { messageId: result.messageId as string }; }
            await tx.scopedOperation.create({ data: { id, accountId: auth.accountId, kind: 'meta-send', result: { digest, state: 'pending' } } }); return null;
        });
        if (replay) return replay;
        try {
            const result = z.object({ message_id: z.string().min(1).max(300), recipient_id: externalId }).parse(await providerJson(`${BASE}/${social.externalId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${social.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient: { id: body.recipientId }, message: { text: body.message }, messaging_type: 'RESPONSE' }) }));
            if (result.recipient_id !== body.recipientId) throw new Error('Recipient acknowledgement mismatch');
            await prisma.scopedOperation.update({ where: { id }, data: { result: { digest, state: 'complete', messageId: result.message_id } } });
            return { messageId: result.message_id };
        } catch { await prisma.scopedOperation.updateMany({ where: { id }, data: { result: { digest, state: 'uncertain' } } }).catch(() => undefined); throw new Error('Meta delivery uncertain; reconcile the original operation'); }
    }
    /** Called only by signature-verified ingress. Atomic storage deduplicates provider mid. */
    static async processWebhookEvent(input: unknown): Promise<void> {
        const entries = z.array(z.object({ id: externalId, time: z.number().finite().nonnegative(), messaging: z.array(eventSchema).max(100).optional() })).max(100).parse(input);
        if (entries.reduce((count, entry) => count + (entry.messaging?.length ?? 0), 0) > 100) throw new Error('Webhook work limit exceeded');
        for (const entry of entries) {
            const channels = await prisma.socialAccount.findMany({ where: { externalId: entry.id, platform: { in: ['FACEBOOK', 'INSTAGRAM'] }, isActive: true }, take: 2 });
            if (channels.length !== 1) throw new Error('Meta page ownership unavailable or ambiguous');
            const social = channels[0];
            for (const event of entry.messaging ?? []) {
                if (!event.message || event.message.is_echo || event.sender.id === entry.id) continue;
                if (event.recipient.id !== entry.id) throw new Error('Webhook recipient mismatch');
                const externalConversationId = `${social.platform}:${entry.id}:${event.sender.id}`, gate = `meta-conversation:${hash([social.accountId, externalConversationId])}`, id = `meta-incoming:${hash([social.id, event.message.mid])}`, digest = hash(event);
                const stored = await prisma.$transaction(async tx => {
                    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${gate}, 0))`;
                    const previous = await tx.scopedOperation.findUnique({ where: { id } });
                    if (previous) { if ((previous.result as any).digest !== digest) throw new Error('Conflicting Meta event identity'); return null; }
                    // Recheck ownership inside the storage transaction; do not attach to a stale connection.
                    const owners = await tx.socialAccount.findMany({ where: { externalId: entry.id, platform: { in: ['FACEBOOK', 'INSTAGRAM'] }, isActive: true }, take: 2 });
                    if (owners.length !== 1 || owners[0].id !== social.id || owners[0].accountId !== social.accountId) throw new Error('Meta ownership changed');
                    const matches = await tx.conversation.findMany({ where: { accountId: social.accountId, externalConversationId }, take: 2 });
                    if (matches.length > 1 || matches[0] && matches[0].socialAccountId !== social.id) throw new Error('Ambiguous Meta conversation');
                    const conversation = matches[0] ?? await tx.conversation.create({ data: { accountId: social.accountId, channel: social.platform as 'FACEBOOK' | 'INSTAGRAM', socialAccountId: social.id, externalConversationId, guestName: `${social.platform} User`, status: 'OPEN', priority: 'MEDIUM' } });
                    // Late/replayed historical events never reopen a closed conversation automatically.
                    const message = event.message!;
                    const content = [message.text, ...(message.attachments ?? []).map(attachment => `Attachment (${attachment.type}): ${attachment.payload.url ?? 'URL unavailable'}`)].filter(Boolean).join('\n');
                    if (!content) throw new Error('Empty Meta message');
                    const saved = await tx.message.create({ data: { conversationId: conversation.id, content, contentType: message.attachments?.length ? 'FILE' : 'TEXT', senderType: 'CUSTOMER', senderId: event.sender.id, createdAt: new Date(event.timestamp) } });
                    await tx.scopedOperation.create({ data: { id, accountId: social.accountId, kind: 'meta-incoming', result: { digest, messageId: saved.id, providerMessageId: message.mid, providerTimestamp: event.timestamp } } });
                    return { conversationId: conversation.id, messageId: saved.id };
                });
                if (stored) EventBus.emit(EVENTS.SOCIAL.MESSAGE_RECEIVED, { accountId: social.accountId, ...stored, platform: social.platform, senderId: event.sender.id });
            }
        }
    }
    static async getInstagramBusinessAccount(pageAccessToken: string, pageId: string): Promise<{ igUserId: string; username: string } | null> {
        externalId.parse(pageId);
        const data = z.object({ instagram_business_account: z.object({ id: externalId, username: z.string().max(300) }).optional() }).parse(await providerJson(`${BASE}/${pageId}?fields=instagram_business_account{id,username}`, { headers: { Authorization: `Bearer ${pageAccessToken}` } }));
        return data.instagram_business_account ? { igUserId: data.instagram_business_account.id, username: data.instagram_business_account.username } : null;
    }
    static verifyWebhookSignature(signature: string, payload: string, appSecret: string): boolean {
        const actual = Buffer.from(signature), expected = Buffer.from(`sha256=${createHmac('sha256', appSecret).update(payload).digest('hex')}`);
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    }
    static async listUserPages(userAccessToken: string): Promise<Array<{ id: string; name: string; accessToken: string }>> {
        const result: Array<{ id: string; name: string; accessToken: string }> = [], seen = new Set<string>(); let after: string | undefined;
        for (let page = 0; page < 5; page++) {
            const url = new URL(`${BASE}/me/accounts`); url.searchParams.set('fields', 'id,name,access_token'); url.searchParams.set('limit', '100'); if (after) url.searchParams.set('after', after);
            const data = z.object({ data: z.array(z.object({ id: externalId, name: z.string().max(300), access_token: z.string().min(1).max(5000) })).max(100), paging: z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().min(1).max(2000) }).optional() }).optional() }).parse(await providerJson(url.href, { headers: { Authorization: `Bearer ${userAccessToken}` } }));
            for (const row of data.data) { if (seen.has(row.id)) throw new Error('Duplicate Meta page'); seen.add(row.id); result.push({ id: row.id, name: row.name, accessToken: row.access_token }); }
            if (!data.paging?.next) return result;
            if (!data.paging.cursors?.after || data.paging.cursors.after === after) throw new Error('Incomplete Meta pagination'); after = data.paging.cursors.after;
        }
        throw new Error('Meta page coverage exceeds review limit');
    }
}
