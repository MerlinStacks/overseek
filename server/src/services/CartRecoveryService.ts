import crypto from 'crypto';
import { prisma } from '../utils/prisma';
import { automationEnrollmentService } from './AutomationEnrollmentService';

interface RecoveryPayload {
    accountId: string;
    enrollmentId?: string;
    sessionId?: string;
    email?: string;
    checkoutUrl: string;
    expiresAt: number;
}

export class CartRecoveryService {
    private getSecret() {
        return process.env.AUTOMATION_RECOVERY_SECRET
            || process.env.JWT_SECRET
            || process.env.APP_SECRET
            || 'development-cart-recovery-secret';
    }

    createRecoveryUrl(input: {
        accountId: string;
        enrollmentId?: string;
        sessionId?: string;
        email?: string;
        checkoutUrl?: string | null;
        expiresInHours?: number;
    }): string | null {
        if (!input.checkoutUrl) {
            return null;
        }

        const expiresInHours = input.expiresInHours ?? 72;
        const payload: RecoveryPayload = {
            accountId: input.accountId,
            enrollmentId: input.enrollmentId,
            sessionId: input.sessionId,
            email: input.email,
            checkoutUrl: input.checkoutUrl,
            expiresAt: Date.now() + expiresInHours * 60 * 60 * 1000
        };

        const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signature = crypto
            .createHmac('sha256', this.getSecret())
            .update(encodedPayload)
            .digest('base64url');

        const baseUrl = process.env.API_URL || 'http://localhost:3000';
        return `${baseUrl}/api/marketing/recover-cart/${encodedPayload}.${signature}`;
    }

    verifyToken(token: string): RecoveryPayload | null {
        const [encodedPayload, signature] = token.split('.');
        if (!encodedPayload || !signature) {
            return null;
        }

        const expectedSignature = crypto
            .createHmac('sha256', this.getSecret())
            .update(encodedPayload)
            .digest('base64url');

        if (signature !== expectedSignature) {
            return null;
        }

        try {
            const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as RecoveryPayload;
            if (!payload.checkoutUrl || payload.expiresAt < Date.now()) {
                return null;
            }
            return payload;
        } catch {
            return null;
        }
    }

    async getRecoveryDetails(token: string) {
        const payload = this.verifyToken(token);
        if (!payload) {
            return null;
        }

        let cartItems: unknown[] = [];
        let currency: string | null = null;
        let automationId: string | null = null;

        if (payload.sessionId) {
            const session = await prisma.analyticsSession.findFirst({
                where: {
                    id: payload.sessionId,
                    accountId: payload.accountId
                },
                select: {
                    cartItems: true,
                    currency: true
                }
            });

            if (session?.cartItems && Array.isArray(session.cartItems)) {
                cartItems = session.cartItems as unknown[];
            }
            currency = session?.currency || currency;
        }

        if ((!Array.isArray(cartItems) || cartItems.length === 0) && payload.enrollmentId) {
            const enrollment = await prisma.automationEnrollment.findFirst({
                where: {
                    id: payload.enrollmentId,
                    accountId: payload.accountId
                },
                select: {
                    automationId: true,
                    contextData: true
                }
            });

            const contextData = (enrollment?.contextData as Record<string, any> | null) || null;
            automationId = enrollment?.automationId || null;
            const fallbackItems = contextData?.cart?.items || contextData?.cartItems || [];
            if (Array.isArray(fallbackItems)) {
                cartItems = fallbackItems;
            }
            currency = contextData?.cart?.currency || contextData?.currency || currency;
        }

        if (payload.enrollmentId && automationId) {
            await automationEnrollmentService.recordRunEvent({
                accountId: payload.accountId,
                automationId,
                enrollmentId: payload.enrollmentId,
                eventType: 'RECOVERY_LINK_OPENED',
                outcome: 'RECOVERY_FETCHED',
                metadata: {
                    sessionId: payload.sessionId ?? null,
                    itemCount: Array.isArray(cartItems) ? cartItems.length : 0
                }
            }).catch(() => undefined);
        }

        return {
            accountId: payload.accountId,
            enrollmentId: payload.enrollmentId,
            sessionId: payload.sessionId,
            email: payload.email || null,
            checkoutUrl: payload.checkoutUrl,
            currency: currency || 'USD',
            items: Array.isArray(cartItems) ? cartItems : []
        };
    }
}

export const cartRecoveryService = new CartRecoveryService();
