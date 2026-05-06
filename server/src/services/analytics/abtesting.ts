import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export interface ExperimentConfig {
    id: string;
    accountId: string;
    name: string;
    description: string;
    variantNames: string[];
    status: 'draft' | 'running' | 'completed';
    conversionEvent: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface VariantResult {
    variant: string;
    impressions: number;
    conversions: number;
    conversionRate: number;
    revenue: number;
    avgRevenuePerUser: number;
}

export interface ExperimentResults {
    experiment: ExperimentConfig;
    variants: VariantResult[];
    totalImpressions: number;
    totalConversions: number;
}

export interface StatisticalSignificance {
    pValue: number;
    confidenceLevel: number;
    isSignificant: boolean;
    sampleSizeSufficient: boolean;
    mde: number;
}

const EXPERIMENTS_KEY = 'ab_experiments';

async function getExperiments(accountId: string): Promise<Record<string, ExperimentConfig>> {
    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { appearance: true }
    });

    const appearance = account?.appearance as Record<string, any> | null | undefined;
    return (appearance?.[EXPERIMENTS_KEY] as Record<string, ExperimentConfig>) || {};
}

async function saveExperiments(accountId: string, experiments: Record<string, ExperimentConfig>): Promise<void> {
    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { appearance: true }
    });

    const appearance = (account?.appearance as Record<string, any> | null) || {};
    appearance[EXPERIMENTS_KEY] = experiments;

    await prisma.account.update({
        where: { id: accountId },
        data: { appearance: appearance as any }
    });
}

export class ABTestingService {
    async createExperiment(
        accountId: string,
        name: string,
        description: string,
        variantNames: string[]
    ): Promise<ExperimentConfig> {
        try {
            if (variantNames.length < 2) {
                throw new Error('At least 2 variants are required');
            }

            const id = crypto.randomUUID();
            const experiments = await getExperiments(accountId);

            const experiment: ExperimentConfig = {
                id,
                accountId,
                name,
                description,
                variantNames,
                status: 'draft',
                conversionEvent: 'purchase',
                createdAt: new Date(),
                updatedAt: new Date()
            };

            experiments[id] = experiment;
            await saveExperiments(accountId, experiments);

            Logger.info('[ABTestingService] Experiment created', { experimentId: id, accountId });
            return experiment;
        } catch (error) {
            Logger.error('[ABTestingService] Create experiment error', { error, accountId });
            throw error;
        }
    }

    async updateExperimentStatus(
        accountId: string,
        experimentId: string,
        status: 'draft' | 'running' | 'completed'
    ): Promise<ExperimentConfig> {
        try {
            const experiments = await getExperiments(accountId);
            const experiment = experiments[experimentId];

            if (!experiment) {
                throw new Error('Experiment not found');
            }

            if (experiment.accountId !== accountId) {
                throw new Error('Experiment not found');
            }

            experiment.status = status;
            experiment.updatedAt = new Date();
            experiments[experimentId] = experiment;
            await saveExperiments(accountId, experiments);

            return experiment;
        } catch (error) {
            Logger.error('[ABTestingService] Update experiment error', { error, experimentId });
            throw error;
        }
    }

    async trackExposure(
        accountId: string,
        experimentId: string,
        variant: string,
        visitorId: string,
        email?: string
    ): Promise<void> {
        try {
            const experiments = await getExperiments(accountId);
            const experiment = experiments[experimentId];

            if (!experiment || experiment.status !== 'running') {
                return;
            }

            if (!experiment.variantNames.includes(variant)) {
                throw new Error('Invalid variant');
            }

            await prisma.analyticsEvent.create({
                data: {
                    sessionId: await this.getOrCreateSession(accountId, visitorId, email),
                    type: 'experiment_exposure',
                    url: '',
                    payload: {
                        experimentId,
                        variant,
                        visitorId,
                        email: email || null
                    }
                }
            });
        } catch (error) {
            Logger.error('[ABTestingService] Track exposure error', { error, experimentId });
        }
    }

    async getExperimentResults(
        accountId: string,
        experimentId: string
    ): Promise<ExperimentResults> {
        try {
            const experiments = await getExperiments(accountId);
            const experiment = experiments[experimentId];

            if (!experiment) {
                throw new Error('Experiment not found');
            }

            const exposureEvents = await prisma.analyticsEvent.findMany({
                where: {
                    type: 'experiment_exposure',
                    session: { accountId },
                    payload: {
                        path: ['experimentId'],
                        equals: experimentId
                    }
                },
                include: {
                    session: {
                        select: {
                            email: true,
                            wooCustomerId: true
                        }
                    }
                }
            });

            const variantData = new Map<string, {
                impressions: Set<string>;
                conversions: Set<string>;
                revenue: number;
            }>();

            for (const variant of experiment.variantNames) {
                variantData.set(variant, {
                    impressions: new Set(),
                    conversions: new Set(),
                    revenue: 0
                });
            }

            const userVariant = new Map<string, string>();

            for (const event of exposureEvents) {
                const payload = event.payload as any;
                const variant = payload?.variant;
                const visitorId = payload?.visitorId;
                const email = (event.session as any)?.email;

                if (!variant || !variantData.has(variant)) continue;

                const userId = visitorId || email || '';
                if (!userId) continue;

                variantData.get(variant)!.impressions.add(userId);
                userVariant.set(userId, variant);
            }

            const purchaseEvents = await prisma.analyticsEvent.findMany({
                where: {
                    type: 'purchase',
                    session: { accountId }
                },
                include: {
                    session: {
                        select: {
                            email: true,
                            visitorId: true
                        }
                    }
                }
            });

            for (const event of purchaseEvents) {
                const session = event.session as any;
                const email = session?.email;
                const visitorId = session?.visitorId;

                const userId = visitorId || email;
                if (!userId) continue;

                const variant = userVariant.get(userId);
                if (!variant || !variantData.has(variant)) continue;

                variantData.get(variant)!.conversions.add(userId);
                const payload = event.payload as any;
                variantData.get(variant)!.revenue += payload?.total || 0;
            }

            const variants: VariantResult[] = experiment.variantNames.map(variant => {
                const data = variantData.get(variant)!;
                const impressions = data.impressions.size;
                const conversions = data.conversions.size;

                return {
                    variant,
                    impressions,
                    conversions,
                    conversionRate: impressions > 0 ? Math.round((conversions / impressions) * 10000) / 100 : 0,
                    revenue: Math.round(data.revenue * 100) / 100,
                    avgRevenuePerUser: impressions > 0 ? Math.round((data.revenue / impressions) * 100) / 100 : 0
                };
            });

            return {
                experiment,
                variants,
                totalImpressions: variants.reduce((sum, v) => sum + v.impressions, 0),
                totalConversions: variants.reduce((sum, v) => sum + v.conversions, 0)
            };
        } catch (error) {
            Logger.error('[ABTestingService] Get experiment results error', { error, experimentId });
            throw error;
        }
    }

    async getStatisticalSignificance(
        accountId: string,
        experimentId: string
    ): Promise<StatisticalSignificance> {
        try {
            const results = await this.getExperimentResults(accountId, experimentId);
            const variants = results.variants;

            if (variants.length < 2) {
                return {
                    pValue: 1,
                    confidenceLevel: 0,
                    isSignificant: false,
                    sampleSizeSufficient: false,
                    mde: 0
                };
            }

            const sorted = [...variants].sort((a, b) => b.conversionRate - a.conversionRate);
            const control = sorted[sorted.length - 1];
            const treatment = sorted[0];

            const p1 = treatment.conversions / Math.max(treatment.impressions, 1);
            const p2 = control.conversions / Math.max(control.impressions, 1);
            const pPooled = (treatment.conversions + control.conversions) /
                Math.max(treatment.impressions + control.impressions, 1);

            const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / treatment.impressions + 1 / control.impressions));
            const zScore = se > 0 ? Math.abs(p1 - p2) / se : 0;

            const pValue = 2 * (1 - this.normalCDF(zScore));
            const confidenceLevel = Math.round((1 - pValue) * 10000) / 100;
            const isSignificant = pValue < 0.05;

            const minSampleSize = this.calculateMinSampleSize(p1, p2, 0.05, 0.8);
            const sampleSizeSufficient = Math.min(treatment.impressions, control.impressions) >= minSampleSize;

            const mde = this.calculateMDE(Math.min(treatment.impressions, control.impressions), 0.05, 0.8);

            return {
                pValue: Math.round(pValue * 10000) / 10000,
                confidenceLevel,
                isSignificant,
                sampleSizeSufficient,
                mde: Math.round(mde * 10000) / 10000
            };
        } catch (error) {
            Logger.error('[ABTestingService] Statistical significance error', { error, experimentId });
            throw error;
        }
    }

    async getExperimentsList(accountId: string): Promise<ExperimentConfig[]> {
        try {
            const experiments = await getExperiments(accountId);
            return Object.values(experiments);
        } catch (error) {
            Logger.error('[ABTestingService] Get experiments list error', { error, accountId });
            throw error;
        }
    }

    // Gaussian CDF approximation
    private normalCDF(x: number): number {
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;

        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x) / Math.sqrt(2);

        const t = 1 / (1 + p * x);
        const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

        return 0.5 * (1 + sign * y);
    }

    private calculateMinSampleSize(p1: number, p2: number, alpha: number, power: number): number {
        const zAlpha = this.inverseNormalCDF(1 - alpha / 2);
        const zBeta = this.inverseNormalCDF(power);
        const pAvg = (p1 + p2) / 2;

        const numerator = Math.pow(zAlpha * Math.sqrt(2 * pAvg * (1 - pAvg)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2);
        const denominator = Math.pow(p1 - p2, 2);

        return denominator > 0 ? Math.ceil(numerator / denominator) : Infinity;
    }

    private calculateMDE(n: number, alpha: number, power: number): number {
        const zAlpha = this.inverseNormalCDF(1 - alpha / 2);
        const zBeta = this.inverseNormalCDF(power);

        return (zAlpha + zBeta) * Math.sqrt(2 / n);
    }

    private inverseNormalCDF(p: number): number {
        if (p <= 0) return -Infinity;
        if (p >= 1) return Infinity;
        if (p === 0.5) return 0;

        const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
            1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
        const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
            6.680131188771972e+01, -1.328068155288572e+01];
        const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
            -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
        const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];

        const pLow = 0.02425;
        const pHigh = 1 - pLow;

        let q, r;

        if (p < pLow) {
            q = Math.sqrt(-2 * Math.log(p));
            return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
        } else if (p <= pHigh) {
            q = p - 0.5;
            r = q * q;
            return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
                (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
        } else {
            q = Math.sqrt(-2 * Math.log(1 - p));
            return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
        }
    }

    private async getOrCreateSession(accountId: string, visitorId: string, email?: string): Promise<string> {
        let session = await prisma.analyticsSession.findFirst({
            where: { accountId, visitorId },
            orderBy: { createdAt: 'desc' }
        });

        if (!session) {
            session = await prisma.analyticsSession.create({
                data: {
                    accountId,
                    visitorId,
                    email: email || null,
                    userAgent: 'ab-testing-service'
                }
            });
        }

        return session.id;
    }
}

export const abTestingService = new ABTestingService();
