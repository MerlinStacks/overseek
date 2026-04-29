import { describe, expect, it } from 'vitest';
import { cartRecoveryService } from '../CartRecoveryService';

describe('CartRecoveryService', () => {
    it('creates and verifies a recovery token', () => {
        const url = cartRecoveryService.createRecoveryUrl({
            accountId: 'acct_1',
            enrollmentId: 'enr_1',
            sessionId: 'sess_1',
            email: 'buyer@example.com',
            checkoutUrl: 'https://store.example.com/checkout'
        });

        expect(url).toBeTruthy();
        const token = url!.split('/').pop()!;
        const payload = cartRecoveryService.verifyToken(token);

        expect(payload).toMatchObject({
            accountId: 'acct_1',
            enrollmentId: 'enr_1',
            sessionId: 'sess_1',
            email: 'buyer@example.com',
            checkoutUrl: 'https://store.example.com/checkout'
        });
    });

    it('rejects tampered recovery tokens', () => {
        const url = cartRecoveryService.createRecoveryUrl({
            accountId: 'acct_1',
            checkoutUrl: 'https://store.example.com/checkout'
        });

        const token = `${url!.split('/').pop()!}tampered`;
        expect(cartRecoveryService.verifyToken(token)).toBeNull();
    });
});
