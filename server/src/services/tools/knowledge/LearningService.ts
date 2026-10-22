import crypto from 'node:crypto';
import { z } from 'zod';
import type { MarketingLearning } from '@prisma/client';
import { prisma } from '../../../utils/prisma';
import { PermissionService } from '../../PermissionService';
const id = z.string().trim().min(1).max(200);
const platform = z.enum(['google', 'meta', 'both']), category = z.enum(['bid_strategy', 'audience', 'creative', 'budget', 'structure', 'optimization']);
export const createLearningSchema = z.object({ id: z.string().uuid(), platform, category, condition: z.string().trim().min(1).max(4000), recommendation: z.string().trim().min(1).max(10000), explanation: z.string().max(10000).optional() }).strict();
export const updateLearningSchema = createLearningSchema.omit({ id: true, platform: true, category: true }).partial().extend({ isActive: z.boolean().optional(), version: z.string().datetime() }).strict();
export const learningVersionSchema = z.object({ version: z.string().datetime() }).strict();
export type LearningPlatform = z.infer<typeof platform>;
export type LearningCategory = z.infer<typeof category>;
export type LearningSource = 'user' | 'ai_derived';
export type CreateLearningInput = z.infer<typeof createLearningSchema>;
export type UpdateLearningInput = z.infer<typeof updateLearningSchema>;
export type LearningWithStats = Omit<MarketingLearning, 'derivedFromRecommendationIds'> & { successRate: null };
const conflict = () => Object.assign(new Error('Learning changed or unavailable; reload'), { statusCode: 409 });
const present = (row: MarketingLearning): LearningWithStats => { const { derivedFromRecommendationIds: _lineage, ...rest } = row; return { ...rest, successRate: null }; };
async function authorize(accountId: string, userId: string) { id.parse(accountId); id.parse(userId); if (!await PermissionService.hasPermission(userId, accountId, 'manage_marketing')) throw Object.assign(new Error('Marketing management permission required'), { statusCode: 403 }); }
export class LearningService {
    static async create(accountId: string, input: CreateLearningInput, userId: string): Promise<LearningWithStats> {
        await authorize(accountId, userId); const data = createLearningSchema.parse(input);
        try { return present(await prisma.marketingLearning.create({ data: { ...data, accountId, source: 'user', isActive: true, isPending: false } })); }
        catch (error) {
            if ((error as { code?: string }).code !== 'P2002') throw error;
            const row = await prisma.marketingLearning.findFirst({ where: { id: data.id, accountId, source: 'user' } });
            if (!row || Object.entries(data).some(([key, value]) => row[key as keyof typeof row] !== value)) throw conflict(); return present(row);
        }
    }
    static async update(learningId: string, accountId: string, input: unknown, userId: string): Promise<LearningWithStats> {
        await authorize(accountId, userId); id.parse(learningId); const { version, ...data } = updateLearningSchema.parse(input);
        return prisma.$transaction(async tx => {
            const changed = await tx.marketingLearning.updateMany({ where: { id: learningId, accountId, updatedAt: new Date(version), isPending: false }, data: { ...data, updatedAt: new Date(Math.max(Date.now(), Date.parse(version) + 1)) } });
            if (changed.count !== 1) throw conflict(); return present(await tx.marketingLearning.findFirstOrThrow({ where: { id: learningId, accountId } }));
        });
    }
    static async delete(learningId: string, accountId: string, input: unknown, userId: string) {
        await authorize(accountId, userId); id.parse(learningId); const { version } = learningVersionSchema.parse(input);
        if ((await prisma.marketingLearning.deleteMany({ where: { id: learningId, accountId, updatedAt: new Date(version) } })).count !== 1) throw conflict(); return true;
    }
    static async list(accountId: string, options: { includeInactive?: boolean; includePending?: boolean; platform?: LearningPlatform; category?: LearningCategory } = {}): Promise<LearningWithStats[]> {
        id.parse(accountId); const parsed = z.object({ includeInactive: z.boolean().optional(), includePending: z.boolean().optional(), platform: platform.optional(), category: category.optional() }).strict().parse(options);
        const rows = await prisma.marketingLearning.findMany({ where: { accountId, ...(!parsed.includeInactive ? { isActive: true } : {}), ...(!parsed.includePending ? { isPending: false } : {}), ...(parsed.platform ? { platform: { in: [parsed.platform, 'both'] } } : {}), ...(parsed.category ? { category: parsed.category } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 501 });
        if (rows.length > 500) throw Object.assign(new Error('Learning coverage limit exceeded; narrow configuration'), { statusCode: 409 });
        return rows.map(present);
    }
    static async getById(learningId: string, accountId: string) { id.parse(accountId); id.parse(learningId); const row = await prisma.marketingLearning.findFirst({ where: { id: learningId, accountId } }); return row ? present(row) : null; }
    static async getPending(accountId: string) { return (await this.list(accountId, { includeInactive: true, includePending: true })).filter(row => row.isPending && row.source === 'ai_derived'); }
    static async approvePending(learningId: string, accountId: string, input: unknown, userId: string) {
        await authorize(accountId, userId); id.parse(learningId); const { version } = learningVersionSchema.parse(input);
        if ((await prisma.marketingLearning.updateMany({ where: { id: learningId, accountId, source: 'ai_derived', isPending: true, updatedAt: new Date(version) }, data: { isPending: false, isActive: true, updatedAt: new Date(Math.max(Date.now(), Date.parse(version) + 1)) } })).count !== 1) throw conflict();
        return true;
    }
    /** Only an explicitly admitted occurrence can count; matching/display alone is not application. */
    static async recordApplication(accountId: string, userId: string, learningId: string, version: string, occurrence: string) {
        await authorize(accountId, userId); id.parse(learningId); id.parse(occurrence); z.string().datetime().parse(version);
        const claimId = crypto.createHash('sha256').update(JSON.stringify(['learning-application', accountId, learningId, occurrence])).digest('hex');
        return prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${claimId}, 0))`;
            if (await tx.scopedOperation.findUnique({ where: { id: claimId } })) return;
            const changed = await tx.marketingLearning.updateMany({ where: { id: learningId, accountId, isActive: true, isPending: false, updatedAt: new Date(version) }, data: { appliedCount: { increment: 1 } } });
            if (changed.count !== 1) throw conflict();
            await tx.scopedOperation.create({ data: { id: claimId, accountId, kind: 'learning-application', result: { learningId, userId, version } } });
        });
    }
    static async recordSuccess(accountId: string, userId: string): Promise<never> { await authorize(accountId, userId); throw conflict(); }
    static async deriveFromOutcomes(accountId: string, userId: string): Promise<never> {
        await authorize(accountId, userId);
        throw Object.assign(new Error('Derivation unavailable: legacy associations do not establish causal effectiveness'), { statusCode: 409 });
    }
}
