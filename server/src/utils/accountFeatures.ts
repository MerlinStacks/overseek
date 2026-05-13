import { prisma } from './prisma';

export async function isAccountFeatureEnabled(
    accountId: string,
    featureKey: string,
    defaultEnabled = false,
): Promise<boolean> {
    const feature = await prisma.accountFeature.findUnique({
        where: { accountId_featureKey: { accountId, featureKey } },
        select: { isEnabled: true },
    });

    if (!feature) return defaultEnabled;
    return feature.isEnabled;
}
