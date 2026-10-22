import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma, type Prisma } from '../../utils/prisma';
import { REVENUE_STATUSES } from '../../constants/orderStatus';

const date = z.union([z.date(), z.iso.datetime().transform(value => new Date(value))]);
const variants = z.array(z.string().trim().min(1).max(100)).min(2).max(10).refine(values => new Set(values).size === values.length, 'Variants must be unique');
const configSchema = z.object({ id: z.string().uuid(), accountId: z.string().min(1), name: z.string().trim().min(1).max(200), description: z.string().max(4000), variantNames: variants,
    status: z.enum(['draft', 'running', 'completed']), conversionEvent: z.literal('purchase'), createdAt: date, updatedAt: date, startedAt: date.optional(), completedAt: date.optional() });
export type ExperimentConfig = z.output<typeof configSchema>;
export interface VariantResult { variant: string; impressions: number; conversions: number; conversionRate: number; revenue: number; avgRevenuePerUser: number }
export interface ExperimentResults { experiment: ExperimentConfig; variants: VariantResult[]; totalImpressions: number; totalConversions: number; currency: string | null; excludedContaminatedVisitors: number; basis: string }
export interface StatisticalSignificance { pValue: number | null; confidenceLevel: null; isSignificant: boolean; sampleSizeSufficient: boolean | null; normalApproximationValid: boolean; mde: null; method: string; reason?: string;
    comparisons: Array<{ control: string; treatment: string; adjustedPValue: number | null; approximationValid: boolean }> }
const KEY = 'ab_experiments';
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const scope = (accountId: string) => z.string().trim().min(1).max(128).parse(accountId);
type DB = Pick<Prisma.TransactionClient, 'account'>;

async function getExperiments(accountId: string, db: DB = prisma): Promise<Record<string, ExperimentConfig>> {
    scope(accountId);
    const account = await db.account.findUnique({ where: { id: accountId }, select: { appearance: true } });
    if (!account) throw new Error('Experiment account not found');
    const raw = object(account.appearance)[KEY];
    if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw))) throw new Error('Experiment configuration unavailable');
    const stored = object(raw);
    if (Object.keys(stored).length > 100) throw new Error('Experiment coverage limit exceeded');
    const result = Object.create(null) as Record<string, ExperimentConfig>;
    for (const [id, value] of Object.entries(stored)) {
        const experiment = configSchema.parse(value);
        if (id !== experiment.id || experiment.accountId !== accountId) throw new Error('Invalid experiment ownership');
        result[id] = experiment;
    }
    return result;
}
async function editExperiments<T>(accountId: string, edit: (experiments: Record<string, ExperimentConfig>) => T) {
    scope(accountId);
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${accountId} FOR NO KEY UPDATE`;
        const experiments = await getExperiments(accountId, tx);
        const result = edit(experiments);
        // Update only this JSON namespace, never overwrite unrelated appearance edits.
        await tx.$executeRaw`UPDATE "Account" SET "appearance" = jsonb_set(COALESCE("appearance", '{}'::jsonb), '{ab_experiments}', ${JSON.stringify(experiments)}::jsonb), "updatedAt" = NOW() WHERE id = ${accountId}`;
        return result;
    });
}
const identity = (event: any) => typeof event.session?.visitorId === 'string' && event.session.visitorId ? event.session.visitorId : typeof object(event.payload).visitorId === 'string' ? object(event.payload).visitorId : null;

export class ABTestingService {
    async createExperiment(accountId: string, name: string, description: string, variantNames: string[]): Promise<ExperimentConfig> {
        const experiment = configSchema.parse({ id: randomUUID(), accountId, name, description, variantNames, status: 'draft', conversionEvent: 'purchase', createdAt: new Date(), updatedAt: new Date() });
        return editExperiments(accountId, experiments => {
            if (Object.keys(experiments).length >= 100) throw new Error('Maximum 100 experiments reached');
            experiments[experiment.id] = experiment; return experiment;
        });
    }
    async updateExperimentStatus(accountId: string, experimentId: string, status: 'draft' | 'running' | 'completed'): Promise<ExperimentConfig> {
        z.string().uuid().parse(experimentId); z.enum(['draft', 'running', 'completed']).parse(status);
        return editExperiments(accountId, experiments => {
            const experiment = experiments[experimentId];
            if (!experiment) throw new Error('Experiment not found');
            if (status === experiment.status) return experiment;
            if (!(experiment.status === 'draft' && status === 'running' || experiment.status === 'running' && status === 'completed')) throw new Error('Invalid experiment transition; use a new experiment instead of reusing observations');
            if (status === 'running') experiment.startedAt = new Date();
            else if (!experiment.startedAt) throw new Error('Legacy experiment has no observation window; create a new experiment');
            else experiment.completedAt = new Date();
            experiment.status = status; experiment.updatedAt = new Date(); return experiment;
        });
    }
    async trackExposure(accountId: string, experimentId: string, variant: string, visitorId: string, email?: string): Promise<void> {
        scope(accountId); z.string().uuid().parse(experimentId); z.string().min(1).max(256).parse(visitorId); z.string().min(1).max(100).parse(variant);
        if (email !== undefined) z.email().parse(email);
        await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${accountId} FOR NO KEY UPDATE`;
            const experiment = (await getExperiments(accountId, tx))[experimentId];
            if (!experiment || experiment.status !== 'running' || !experiment.startedAt) throw new Error('Experiment is not running with a known observation window');
            if (!experiment.variantNames.includes(variant)) throw new Error('Invalid variant');
            const existing = await tx.analyticsEvent.findFirst({ where: { type: 'experiment_exposure', session: { accountId, visitorId }, payload: { path: ['experimentId'], equals: experimentId } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
            if (existing) { if (object(existing.payload).variant !== variant) throw new Error('Visitor already assigned to another variant'); return; }
            let session = await tx.analyticsSession.findFirst({ where: { accountId, visitorId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
            if (!session) session = await tx.analyticsSession.create({ data: { accountId, visitorId, email: email || null, userAgent: 'ab-testing-service' } });
            await tx.analyticsEvent.create({ data: { sessionId: session.id, type: 'experiment_exposure', url: '', payload: { experimentId, variant, visitorId } } });
        });
    }
    async getExperimentResults(accountId: string, experimentId: string): Promise<ExperimentResults> {
        z.string().uuid().parse(experimentId);
        const experiment = (await getExperiments(accountId))[experimentId];
        if (!experiment) throw new Error('Experiment not found');
        if (!experiment.startedAt) throw new Error('Experiment observation window is unavailable');
        const end = experiment.completedAt || new Date();
        if (end < experiment.startedAt) throw new Error('Invalid experiment observation window');
        const query = { createdAt: { gte: experiment.startedAt, lte: end }, session: { accountId } };
        const [exposures, purchases] = await Promise.all([
            prisma.analyticsEvent.findMany({ where: { ...query, type: 'experiment_exposure', payload: { path: ['experimentId'], equals: experimentId } }, include: { session: { select: { visitorId: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50001 }),
            prisma.analyticsEvent.findMany({ where: { ...query, type: 'purchase' }, include: { session: { select: { visitorId: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50001 }),
        ]);
        if (exposures.length > 50000 || purchases.length > 50000) throw new Error('Experiment observation coverage limit exceeded');
        const assignments = new Map<string, { variant: string; at: Date }>(); const contaminated = new Set<string>();
        for (const event of exposures) {
            const user = identity(event); const variant = object(event.payload).variant;
            if (!user || !experiment.variantNames.includes(variant)) throw new Error('Invalid experiment exposure');
            const previous = assignments.get(user);
            if (previous && previous.variant !== variant) contaminated.add(user);
            if (!previous) assignments.set(user, { variant, at: event.createdAt });
        }
        const observed = new Map<number, { user: string; at: Date }>();
        for (const event of purchases) {
            const user = identity(event); const assigned = user && assignments.get(user);
            if (!assigned || contaminated.has(user) || event.createdAt < assigned.at) continue;
            const value = object(event.payload).orderId ?? object(event.payload).order_id;
            if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0 || Number(value) > 2147483647) throw new Error('Stable purchase order ID unavailable for experiment attribution');
            const previous = observed.get(Number(value));
            if (previous && previous.user !== user) throw new Error('Purchase has ambiguous experiment identity');
            if (!previous) observed.set(Number(value), { user, at: event.createdAt });
        }
        if (observed.size > 10000) throw new Error('Experiment purchase coverage limit exceeded');
        const orders = observed.size ? await prisma.wooOrder.findMany({ where: { accountId, wooId: { in: [...observed.keys()] } }, select: { wooId: true, total: true, currency: true, dateCreated: true, status: true } }) : [];
        if (orders.length !== observed.size) throw new Error('Authoritative experiment order coverage unavailable; synchronize orders before reporting');
        const currencies = new Set(orders.map(order => order.currency));
        if (currencies.size > 1) throw new Error('Experiment revenue currencies are mixed');
        const data = new Map(experiment.variantNames.map(variant => [variant, { users: new Set<string>(), conversions: new Set<string>(), revenue: 0 }]));
        for (const [user, assignment] of assignments) if (!contaminated.has(user)) data.get(assignment.variant)!.users.add(user);
        for (const order of orders) {
            if (!REVENUE_STATUSES.includes(order.status)) continue;
            const purchase = observed.get(order.wooId)!; const assigned = assignments.get(purchase.user)!;
            if (order.dateCreated < assigned.at || order.dateCreated > end) continue;
            const total = Number(order.total);
            if (!Number.isFinite(total) || total < 0 || !/^[A-Z]{3}$/.test(order.currency)) throw new Error('Experiment order revenue unavailable');
            const row = data.get(assigned.variant)!; row.conversions.add(purchase.user); row.revenue += total;
        }
        const results = experiment.variantNames.map(variant => {
            const row = data.get(variant)!; const impressions = row.users.size; const conversions = row.conversions.size;
            return { variant, impressions, conversions, conversionRate: impressions ? conversions / impressions * 100 : 0, revenue: row.revenue, avgRevenuePerUser: impressions ? row.revenue / impressions : 0 };
        });
        return { experiment, variants: results, totalImpressions: results.reduce((sum, row) => sum + row.impressions, 0), totalConversions: results.reduce((sum, row) => sum + row.conversions, 0),
            currency: orders[0]?.currency ?? null, excludedContaminatedVisitors: contaminated.size, basis: 'Known experiment window, stable visitor assignment, unique authoritative local revenue orders after exposure' };
    }
    async getStatisticalSignificance(accountId: string, experimentId: string): Promise<StatisticalSignificance> {
        const results = await this.getExperimentResults(accountId, experimentId);
        const control = results.variants[0];
        const comparisons = results.variants.slice(1).map(treatment => {
            const valid = [control, treatment].every(row => row.conversions >= 10 && row.impressions - row.conversions >= 10);
            let adjustedPValue: number | null = null;
            if (valid) {
                const pooled = (control.conversions + treatment.conversions) / (control.impressions + treatment.impressions);
                const se = Math.sqrt(pooled * (1 - pooled) * (1 / control.impressions + 1 / treatment.impressions));
                const z = Math.abs(control.conversions / control.impressions - treatment.conversions / treatment.impressions) / se;
                const t = 1 / (1 + 0.2316419 * z);
                const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
                adjustedPValue = Math.min(1, Math.max(0, 2 * tail * (results.variants.length - 1)));
            }
            return { control: control.variant, treatment: treatment.variant, adjustedPValue, approximationValid: valid };
        });
        const values = comparisons.flatMap(row => row.adjustedPValue == null ? [] : [row.adjustedPValue]);
        return { pValue: values.length ? Math.min(...values) : null, confidenceLevel: null, mde: null,
            isSignificant: results.experiment.status === 'completed' && comparisons.some(row => row.adjustedPValue != null && row.adjustedPValue < 0.05),
            sampleSizeSufficient: comparisons.every(row => row.approximationValid) ? null : false,
            normalApproximationValid: comparisons.every(row => row.approximationValid), comparisons,
            method: 'First configured variant is control; two-sided two-proportion normal approximation with Bonferroni correction. No winner probability or power/MDE claim.',
            reason: results.experiment.status !== 'completed' ? 'Running results are exploratory; no stopping/peeking correction is provided' : values.length !== comparisons.length ? 'Insufficient success/failure counts for normal approximation' : undefined };
    }
    async getExperimentsList(accountId: string): Promise<ExperimentConfig[]> { return Object.values(await getExperiments(accountId)); }
}
export const abTestingService = new ABTestingService();
