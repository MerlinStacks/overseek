import type { User } from '@prisma/client';
import { createGuardrails, generateSync } from 'otplib';
import { describe, expect, it, vi } from 'vitest';
import { SecurityService } from './SecurityService';

vi.mock('../utils/auth', () => ({ generateToken: vi.fn() }));

describe('SecurityService two-factor authentication', () => {
    it('verifies legacy otplib 12 secrets and rejects invalid tokens', () => {
        const secret = 'JBSWY3DPEHPK3PXP';
        const token = generateSync({
            secret,
            guardrails: createGuardrails({ MIN_SECRET_BYTES: 10 }),
        });
        const invalidToken = `${token[0] === '0' ? '1' : '0'}${token.slice(1)}`;

        expect(SecurityService.verifyTwoFactorToken(token, secret)).toBe(true);
        expect(SecurityService.verifyTwoFactorToken(invalidToken, secret)).toBe(false);
    });

    it('generates stronger secrets and provisioning QR codes for new enrollments', async () => {
        const setup = await SecurityService.generateTwoFactorSecret({
            email: 'user@example.com',
        } as User);
        const token = generateSync({ secret: setup.secret });

        expect(setup.secret.length).toBeGreaterThanOrEqual(32);
        expect(setup.qrCodeUrl).toMatch(/^data:image\/png;base64,/);
        expect(SecurityService.verifyTwoFactorToken(token, setup.secret)).toBe(true);
    });
});
