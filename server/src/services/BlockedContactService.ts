import { createHash } from 'crypto';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { invalidateCache } from '../utils/cache';
import { Logger } from '../utils/logger';

const scope = z.string().min(1).max(200);
export function canonicalBlockedEmail(value: unknown): string {
    return z.string().trim().max(254).email().parse(value).toLowerCase();
}
export const blockCommandSchema = z.object({ operationId: z.string().uuid(), version: z.string().datetime().nullable(), reason: z.string().trim().max(500).optional(), conversationVersion: z.string().datetime().optional() }).strict();
type Command = z.infer<typeof blockCommandSchema>;
const conflict = () => Object.assign(new Error('Block state changed or acknowledgement unavailable; reconcile original operation'), { statusCode: 409 });
const headId = (accountId: string, email: string) => `blocked-contact-version:${createHash('sha256').update(JSON.stringify([accountId, email])).digest('hex')}`;
export class BlockedContactService {
    /** Authoritative decision at read time. DB failure propagates and must not
     * authorize an autoreply. Redis negative caches are never delivery evidence. */
    static async isBlocked(accountId: string, email: string): Promise<boolean> {
        scope.parse(accountId);
        return !!await prisma.blockedContact.findUnique({ where: { accountId_email: { accountId, email: canonicalBlockedEmail(email) } }, select: { id: true } });
    }
    static async getBlockedContact(accountId: string, email: string) {
        scope.parse(accountId);
        return prisma.blockedContact.findUnique({ where: { accountId_email: { accountId, email: canonicalBlockedEmail(email) } }, include: { blocker: { select: { id: true, fullName: true } } } });
    }
    /** Persisted tombstone versions prevent an absent→blocked→absent cycle from
     * admitting an old create/unblock command against the same null version. */
    static async getBlockObservation(accountId: string, email: string) {
        scope.parse(accountId); const normalized = canonicalBlockedEmail(email);
        return prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`block-contact:${accountId}:${normalized}`}, 0))`;
            const contact = await tx.blockedContact.findUnique({ where: { accountId_email: { accountId, email: normalized } } });
            const head = await tx.scopedOperation.findUnique({ where: { id: headId(accountId, normalized) } });
            return { contact, version: head ? z.object({ version: z.string().datetime() }).parse(head.result).version : contact?.blockedAt.toISOString() ?? null };
        });
    }
    static async blockContact(accountId: string, email: string, actorId?: string, reason?: string, command?: Command, conversationId?: string) {
        return this.command(accountId, email, actorId, true, { ...command, reason: reason ?? command?.reason }, conversationId);
    }
    static async unblockContact(accountId: string, email: string, actorId?: string, command?: Command) {
        return this.command(accountId, email, actorId, false, command);
    }
    private static async command(accountId: string, email: string, actorId: string | undefined, blocked: boolean, input: unknown, conversationId?: string) {
        scope.parse(accountId); scope.parse(actorId);
        const normalized = canonicalBlockedEmail(email), body = blockCommandSchema.parse(input);
        const digest = createHash('sha256').update(JSON.stringify([actorId, normalized, blocked, body, conversationId])).digest('hex');
        const id = `block-contact:${accountId}:${body.operationId}`;
        const snapshot = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`block-contact:${accountId}:${normalized}`}, 0))`;
            const receipt = await tx.scopedOperation.findUnique({ where: { id } });
            if (receipt) { const value = receipt.result as any; if (value.digest !== digest) throw conflict(); return value.snapshot; }
            const previous = await tx.blockedContact.findUnique({ where: { accountId_email: { accountId, email: normalized } } });
            const versionId = headId(accountId, normalized);
            const head = await tx.scopedOperation.findUnique({ where: { id: versionId } });
            const observedVersion = head ? z.object({ version: z.string().datetime() }).parse(head.result).version : previous?.blockedAt.toISOString() ?? null;
            if (observedVersion !== body.version) throw conflict();
            if (conversationId) {
                scope.parse(conversationId);
                const conversation = await tx.conversation.findFirst({ where: { id: conversationId, accountId }, include: { wooCustomer: { select: { email: true } } } });
                if (!conversation || conversation.updatedAt.toISOString() !== body.conversationVersion || canonicalBlockedEmail(conversation.wooCustomer?.email || conversation.guestEmail) !== normalized) throw conflict();
                const changed = await tx.conversation.updateMany({ where: { id: conversationId, accountId, updatedAt: conversation.updatedAt }, data: { status: 'CLOSED' } });
                if (changed.count !== 1) throw conflict();
            }
            const when = new Date(Math.max(Date.now(), (previous?.blockedAt.getTime() ?? 0) + 1, observedVersion ? Date.parse(observedVersion) + 1 : 0));
            if (blocked) await tx.blockedContact.upsert({ where: { accountId_email: { accountId, email: normalized } }, create: { accountId, email: normalized, blockedBy: actorId, reason: body.reason, blockedAt: when }, update: { blockedBy: actorId, reason: body.reason, blockedAt: when } });
            else await tx.blockedContact.deleteMany({ where: { accountId, email: normalized, ...(previous ? { blockedAt: previous.blockedAt } : {}) } });
            await tx.scopedOperation.upsert({ where: { id: versionId }, create: { id: versionId, accountId, kind: 'blocked-contact-version', result: { version: when.toISOString() } }, update: { result: { version: when.toISOString() } } });
            const result = { success: true, accountId, email: normalized, blocked, version: when.toISOString(), operationId: body.operationId };
            await tx.scopedOperation.create({ data: { id, accountId, kind: 'blocked-contact', result: { digest, snapshot: result } } });
            return result;
        });
        // Cache notification is best effort after commit, never a false mutation failure.
        try { await invalidateCache('inbox', `conversations:${accountId}`); } catch { Logger.warn('[BlockedContact] Inbox cache refresh unavailable', { accountId }); }
        return snapshot;
    }
    static async listBlocked(accountId: string, cursor?: string) {
        scope.parse(accountId); if (cursor) scope.parse(cursor);
        return prisma.blockedContact.findMany({ where: { accountId }, take: 101, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { blocker: { select: { id: true, fullName: true } } }, orderBy: { id: 'asc' } });
    }
    static async listBlockedEmails(accountId: string): Promise<string[]> {
        scope.parse(accountId);
        const contacts = await prisma.blockedContact.findMany({ where: { accountId }, select: { email: true }, take: 10001 });
        if (contacts.length > 10000) throw new Error('Blocked-contact filter coverage exceeds supported window');
        return contacts.map(contact => canonicalBlockedEmail(contact.email));
    }
}
