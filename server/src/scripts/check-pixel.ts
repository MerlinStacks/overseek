import { prisma } from '../utils/prisma';

async function run() {
    const feats = await prisma.accountFeature.findMany({
        where: { featureKey: 'GOOGLE_ENHANCED_CONVERSIONS' },
        include: { account: true }
    });
    console.log(JSON.stringify(feats, null, 2));
}

run()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
