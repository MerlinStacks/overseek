import { expect, it } from 'vitest';
import { EmailAccountBodySchema, EmailCommandMetaSchema, EmailPortSchema, TestConnectionBodySchema, TestRelayBodySchema } from './schemas';
it('accepts exact integer ports only, not truncation, infinity, overflow or empty strings', () => {
    expect(EmailPortSchema.parse('587')).toBe(587);
    for (const value of ['587x', '587.5', '', '1e3', 0, -1, 65536, Infinity, 587.5]) expect(EmailPortSchema.safeParse(value).success).toBe(false);
});
it('requires enabled protocol fields, explicit secure tests, bounded secrets and HTTPS relay ownership syntax', () => {
    expect(EmailAccountBodySchema.safeParse({ smtpEnabled: true }).success).toBe(false);
    expect(EmailAccountBodySchema.safeParse({ name: 'x', unexpected: 'ignored?' }).success).toBe(false);
    expect(EmailAccountBodySchema.safeParse({ smtpPassword: 'x'.repeat(1001) }).success).toBe(false);
    for (const url of ['http://relay.test', 'https://user:secret@relay.test']) expect(TestRelayBodySchema.safeParse({ relayEndpoint: url }).success).toBe(false);
    expect(TestConnectionBodySchema.safeParse({ protocol: 'SMTP', host: 'smtp.example.test', port: 587, username: 'synthetic', password: 'synthetic', isSecure: false }).success).toBe(false);
    expect(EmailCommandMetaSchema.safeParse({}).success).toBe(false);
});
