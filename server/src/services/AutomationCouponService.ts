import { randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { WooService } from './woo';

const inputSchema = z.object({
    accountId: z.string().min(1), automationId: z.string().min(1), enrollmentId: z.string().min(1), nodeId: z.string().min(1).max(200),
    email: z.email().nullable().optional(),
    config: z.object({ codePrefix: z.string().regex(/^[A-Za-z0-9]{1,10}$/).optional(),
        amount: z.union([z.number(), z.string().regex(/^\d+(?:\.\d{1,2})?$/).transform(Number)]).pipe(z.number().finite().positive().max(100000)).default(10),
        discountType: z.enum(['percent', 'fixed_cart']).default('percent'),
        expiryDays: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(1).max(365)).default(7),
        description: z.string().max(500).optional(), individualUse: z.boolean().default(true) }),
});
type GenerateCouponInput = z.input<typeof inputSchema>;

export class AutomationCouponService {
    async generateCoupon(input: GenerateCouponInput) {
        const value = inputSchema.parse(input);
        const { accountId, automationId, enrollmentId, nodeId, config } = value;
        if (config.discountType === 'percent' && config.amount > 100) throw new Error('Percentage discount cannot exceed 100');
        const enrollment = await prisma.automationEnrollment.findFirst({ where: { id: enrollmentId, automationId, automation: { accountId } } });
        if (!enrollment) throw new Error('Coupon enrollment not found in account/automation');
        const key = { accountId, enrollmentId, nodeId };
        // Reserve the random code durably before contacting WooCommerce. Retries retain this code.
        const record = await prisma.generatedCoupon.upsert({ where: { accountId_enrollmentId_nodeId: key }, update: {}, create: {
            ...key, automationId, code: `${config.codePrefix || 'OS'}-${randomBytes(12).toString('hex')}`.toUpperCase(),
            amount: config.amount, discountType: config.discountType, description: config.description || 'Automation coupon',
            expiresAt: new Date(Date.now() + config.expiryDays * 86400000),
            metadata: { individualUse: config.individualUse, email: value.email || null },
        } });
        if (!record.wooCouponId) {
            const claim = await prisma.generatedCoupon.updateMany({ where: { id: record.id, accountId, creationClaimed: false, wooCouponId: null }, data: { creationClaimed: true } });
            if (claim.count !== 1) throw new Error('Coupon creation is pending or ambiguous; reconcile the reserved code with WooCommerce before retrying');
            const woo = await WooService.forAccount(accountId);
            const metadata = record.metadata as { individualUse: boolean; email: string | null };
            const created = await woo.createCoupon({ code: record.code, amount: record.amount.toFixed(2), discount_type: record.discountType,
                description: record.description, date_expires: record.expiresAt.toISOString(), usage_limit: 1, usage_limit_per_user: 1,
                individual_use: metadata.individualUse, ...(metadata.email ? { email_restrictions: [metadata.email] } : {}) });
            if (!Number.isSafeInteger(created?.id) || created.id <= 0 || typeof created.code !== 'string' || created.code.toLowerCase() !== record.code.toLowerCase()) throw new Error('Coupon provider confirmation unavailable; reserved code requires reconciliation');
            await prisma.generatedCoupon.update({ where: { id: record.id, accountId }, data: { wooCouponId: created.id } });
            record.wooCouponId = created.id;
        }
        return { id: record.id, wooCouponId: record.wooCouponId, code: record.code, amount: Number(record.amount), discountType: record.discountType,
            description: record.description, expiresAt: record.expiresAt.toISOString() };
    }
}
export const automationCouponService = new AutomationCouponService();
