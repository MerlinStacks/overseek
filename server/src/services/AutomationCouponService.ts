import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { WooService } from './woo';

interface GenerateCouponInput {
    accountId: string;
    automationId: string;
    enrollmentId: string;
    email?: string | null;
    config: {
        codePrefix?: string;
        amount?: number | string;
        discountType?: 'percent' | 'fixed_cart';
        expiryDays?: number;
        description?: string;
        individualUse?: boolean;
    };
}

export class AutomationCouponService {
    async generateCoupon(input: GenerateCouponInput) {
        const amount = Number(input.config.amount ?? 10);
        const discountType = input.config.discountType === 'fixed_cart' ? 'fixed_cart' : 'percent';
        const expiryDays = Math.max(1, Number(input.config.expiryDays ?? 7));
        const code = this.generateCode(input.config.codePrefix);
        const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

        const wooService = await WooService.forAccount(input.accountId);
        const payload = {
            code,
            amount: amount.toFixed(2),
            discount_type: discountType,
            description: input.config.description || `Automation coupon for ${input.email || 'customer'}`,
            date_expires: expiresAt.toISOString(),
            usage_limit: 1,
            usage_limit_per_user: 1,
            individual_use: input.config.individualUse ?? true,
            ...(input.email ? { email_restrictions: [input.email] } : {})
        };

        const created = await wooService.createCoupon(payload);

        const record = await (prisma as any).generatedCoupon.create({
            data: {
                accountId: input.accountId,
                automationId: input.automationId,
                enrollmentId: input.enrollmentId,
                wooCouponId: created?.id ? Number(created.id) : null,
                code,
                amount,
                discountType,
                description: payload.description,
                expiresAt,
                metadata: created
            }
        });

        Logger.info('[AutomationCouponService] Generated automation coupon', {
            accountId: input.accountId,
            automationId: input.automationId,
            enrollmentId: input.enrollmentId,
            code
        });

        return {
            id: record.id,
            wooCouponId: record.wooCouponId,
            code: record.code,
            amount,
            discountType,
            description: record.description,
            expiresAt: expiresAt.toISOString()
        };
    }

    private generateCode(prefix?: string) {
        const cleanPrefix = (prefix || 'OS')
            .replace(/[^A-Za-z0-9]/g, '')
            .toUpperCase()
            .slice(0, 10);
        const suffix = Math.random().toString(36).slice(2, 10).toUpperCase();
        return `${cleanPrefix}-${suffix}`;
    }
}

export const automationCouponService = new AutomationCouponService();
