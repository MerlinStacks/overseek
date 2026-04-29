import { z } from 'zod';

export const EmailAccountBodySchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    smtpEnabled: z.boolean().optional(),
    smtpHost: z.string().optional(),
    smtpPort: z.union([z.number(), z.string()]).optional(),
    smtpUsername: z.string().optional(),
    smtpPassword: z.string().optional(),
    smtpSecure: z.boolean().optional(),
    imapEnabled: z.boolean().optional(),
    imapHost: z.string().optional(),
    imapPort: z.union([z.number(), z.string()]).optional(),
    imapUsername: z.string().optional(),
    imapPassword: z.string().optional(),
    imapSecure: z.boolean().optional(),
    relayEndpoint: z.string().url().optional(),
    relayApiKey: z.string().optional(),
});

export const TestConnectionBodySchema = z.object({
    id: z.string().optional(),
    protocol: z.enum(['SMTP', 'IMAP']),
    host: z.string().min(1),
    port: z.union([z.number(), z.string()]),
    username: z.string().min(1),
    password: z.string().min(1),
    isSecure: z.boolean().optional(),
});

export const SuppressionBodySchema = z.object({
    email: z.string().email().optional(),
    scope: z.enum(['MARKETING', 'ALL']).optional(),
    reason: z.string().optional(),
});

export const DeliveryEventBodySchema = z.object({
    eventType: z.enum(['BOUNCE', 'COMPLAINT']),
    reason: z.string().optional(),
});

export const TestRelayBodySchema = z.object({
    relayEndpoint: z.string().url(),
    relayApiKey: z.string().optional(),
    emailAccountId: z.string().optional(),
    testEmail: z.string().email().optional(),
});
