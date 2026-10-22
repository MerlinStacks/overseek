import { z } from 'zod';
import { createHash } from 'crypto';
import { prisma } from '../utils/prisma';
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const day = z.object({ open: time, close: time, isOpen: z.boolean() }).strict().refine(value => !value.isOpen || value.open < value.close, 'Use an ordered same-day interval; overnight hours are unsupported');
export const chatConfigSchema = z.object({ enabled: z.boolean(), position: z.enum(['bottom-right', 'bottom-left']), showOnMobile: z.boolean(), primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i), headerText: z.string().trim().min(1).max(30), welcomeMessage: z.string().max(200), autoReply: z.object({ enabled: z.boolean(), message: z.string().max(2000) }).strict(), businessHours: z.object({ enabled: z.boolean(), days: z.object({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }).strict(), offlineMessage: z.string().max(10000) }).strict(), businessTimezone: z.string().max(100) }).strict().refine(value => { if (!value.businessTimezone) return !value.businessHours.enabled; try { new Intl.DateTimeFormat('en', { timeZone: value.businessTimezone }); return true; } catch { return false; } }, 'Select a valid business timezone');
export const defaultChatConfig = () => ({ enabled: false, position: 'bottom-right' as const, showOnMobile: true, primaryColor: '#2563eb', headerText: 'Live Chat', welcomeMessage: 'Hello! How can we help you today?', autoReply: { enabled: false, message: '' }, businessHours: { enabled: false, days: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => [day, { open: '09:00', close: '17:00', isOpen: false }])), offlineMessage: '' }, businessTimezone: '' });
export async function readChatSettings(accountId: string) {
    const row = await prisma.accountFeature.findUnique({ where: { accountId_featureKey: { accountId, featureKey: 'CHAT_SETTINGS' } } });
    return { config: row ? chatConfigSchema.parse({ businessTimezone: '', ...(row.config as object) }) : chatConfigSchema.parse(defaultChatConfig()), version: row?.updatedAt.toISOString() ?? null };
}
export async function saveChatSettings(accountId: string, userId: string, input: unknown) {
    const body = z.object({ operationId: z.string().uuid(), version: z.string().datetime().nullable(), config: chatConfigSchema }).strict().parse(input);
    const digest = createHash('sha256').update(JSON.stringify([userId, body])).digest('hex'), id = `chat-settings:${accountId}:${body.operationId}`;
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`chat-settings:${accountId}`}, 0))`;
        const receipt = await tx.scopedOperation.findUnique({ where: { id } });
        if (receipt) { const result = receipt.result as any; if (result.digest !== digest) throw Object.assign(new Error('Operation identity changed'), { statusCode: 409 }); return { ...result.snapshot, newlySaved: false }; }
        const existing = await tx.accountFeature.findUnique({ where: { accountId_featureKey: { accountId, featureKey: 'CHAT_SETTINGS' } } });
        if ((existing?.updatedAt.toISOString() ?? null) !== body.version) throw Object.assign(new Error('Settings changed; reload without losing your draft'), { statusCode: 409 });
        const updatedAt = new Date(Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1));
        if (existing) {
            const saved = await tx.accountFeature.updateMany({ where: { id: existing.id, accountId, updatedAt: existing.updatedAt }, data: { config: body.config, isEnabled: body.config.enabled, updatedAt } });
            if (saved.count !== 1) throw Object.assign(new Error('Settings changed'), { statusCode: 409 });
        } else await tx.accountFeature.create({ data: { accountId, featureKey: 'CHAT_SETTINGS', config: body.config, isEnabled: body.config.enabled, updatedAt } });
        const snapshot = { config: body.config, version: updatedAt.toISOString(), storefrontSync: 'requested-unconfirmed' };
        await tx.scopedOperation.create({ data: { id, accountId, kind: 'chat-settings-save', result: { digest, snapshot } } });
        return { ...snapshot, newlySaved: true };
    });
}
