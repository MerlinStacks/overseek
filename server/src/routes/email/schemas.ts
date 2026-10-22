import { z } from 'zod';
const text = z.string().max(1000);
export const EmailPortSchema = z.union([z.number(), z.string().regex(/^\d{1,5}$/).transform(Number)]).pipe(z.number().int().min(1).max(65535));
const host = z.string().trim().min(1).max(253).regex(/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/);
const httpsUrl = z.string().url().max(2000).refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash; }, 'Use a credential-free HTTPS endpoint');
export const EmailCommandMetaSchema = z.object({ operationId: z.string().uuid(), version: z.string().datetime().nullable() });

export const EmailAccountBodySchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().max(254).optional(),
    smtpEnabled: z.boolean().optional(),
    smtpHost: host.or(z.literal('')).optional(),
    smtpPort: EmailPortSchema.optional(),
    smtpUsername: text.optional(),
    smtpPassword: text.optional(),
    smtpSecure: z.boolean().optional(),
    imapEnabled: z.boolean().optional(),
    imapHost: host.or(z.literal('')).optional(),
    imapPort: EmailPortSchema.optional(),
    imapUsername: text.optional(),
    imapPassword: text.optional(),
    imapSecure: z.boolean().optional(),
    relayEndpoint: z.preprocess((value) => value === '' ? undefined : value, httpsUrl.optional()),
    relayApiKey: text.optional(),
    relayProfileId: z.string().max(200).optional(),
}).strict().superRefine((value, ctx) => {
    if (value.smtpEnabled && (!value.smtpHost || !value.smtpPort || value.smtpSecure === false) || value.imapEnabled && (!value.imapHost || !value.imapPort || value.imapSecure === false) || value.smtpEnabled && value.relayEndpoint) ctx.addIssue({ code: 'custom', message: 'Enabled protocols require explicit host, port and TLS; select SMTP or relay, not both' });
});

export const TestConnectionBodySchema = z.object({
    id: z.string().min(1).max(200).optional(),
    protocol: z.enum(['SMTP', 'IMAP']),
    host,
    port: EmailPortSchema,
    username: text.min(1),
    password: text.min(1),
    isSecure: z.literal(true),
}).strict();

export const SuppressionBodySchema = z.object({
    email: z.string().email().optional(),
    scope: z.enum(['MARKETING', 'ALL']).optional(),
    reason: z.string().max(1000).optional(),
});

export const DeliveryEventBodySchema = z.object({
    eventType: z.enum(['BOUNCE', 'COMPLAINT']),
    reason: z.string().max(1000).optional(),
});

export const TestRelayBodySchema = z.object({
    relayEndpoint: httpsUrl,
    relayApiKey: text.optional(),
    relayProfileId: z.string().max(200).optional(),
    emailAccountId: z.string().min(1).max(200).optional(),
    testEmail: z.string().email().optional(),
}).strict();

export const EmailSettingsBodySchema = z.object({
    bounceTrackingEnabled: z.boolean(),
    maxSendPerSecond: z.number().int().min(1).max(1000),
    maxSendPerDay: z.number().int().min(1).max(1000000),
});
