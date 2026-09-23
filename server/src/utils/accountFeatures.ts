import { prisma } from './prisma';

/** Resolve account overrides; delivery estimates alone are available by default. */
export async function isAccountFeatureEnabled(
    accountId: string,
    featureKey: string,
    defaultEnabled = featureKey === 'DELIVERY_ESTIMATES',
): Promise<boolean> {
    const feature = await prisma.accountFeature.findUnique({
        where: { accountId_featureKey: { accountId, featureKey } },
        select: { isEnabled: true },
    });

    if (!feature) return defaultEnabled;
    return feature.isEnabled;
}
